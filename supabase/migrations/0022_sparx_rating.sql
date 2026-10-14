-- Sparx Rating: practice score (with diminishing returns + recency) + contest rating (Elo).
--
-- How to apply: Supabase project → SQL Editor → paste this whole file → Run.
-- Safe to run once, after 0001-0021. After applying, open Admin → Contests and click
-- "Update ratings" once so finished contests are rated.
--
-- Practice score (per user), replacing 0016's:
--   sum over solved problems of
--     difficulty points (starter 5, easy 10, medium 25, hard 50)
--     x attempt multiplier   greatest(0.5, 1.1 - 0.1 * wrong Submits before the first AC)
--     x diminishing returns  1 / (1 + 0.03 * n)   n = how many problems of that difficulty
--                            the user solved earlier (so farming easy problems pays less)
--     x recency              1.0 for solves up to 180 days old, then falling linearly to a
--                            floor of 0.5 at about a year
--   + 5 per distinct topic solved (max 15 topics, as before)
--
-- Contest rating: Elo, starting at 1000. recompute_contest_ratings() walks every finished
-- contest in order of end time. In each contest every pair of participants is compared on
-- their final contest rank (get_contest_standings): the winner of a pair scores 1, a tie 0.5.
-- A participant's change is K x the average of (actual - expected) over everyone else, with
-- expected = 1 / (1 + 10^((opponent - own) / 400)). K is 48 for a participant's first 3
-- contests (provisional) and 32 afterwards. It is deterministic and safe to re-run.
--
-- Overall score = practice score + max(0, contest rating - 1000). Ranked by that, then by
-- problems solved.

create table public.contest_ratings (
  contest_id     uuid not null references public.contests(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  rank           int  not null,
  participants   int  not null,
  rating_before  int  not null,
  rating_after   int  not null,
  created_at     timestamptz not null default now(),
  primary key (contest_id, user_id)
);

alter table public.contest_ratings enable row level security;

create policy "signed-in users can read contest ratings"
  on public.contest_ratings for select
  using (auth.uid() is not null);

create view public.user_contest_rating as
select distinct on (cr.user_id)
  cr.user_id,
  cr.rating_after as rating,
  (count(*) over (partition by cr.user_id))::int as contests_played,
  cr.rating_after - cr.rating_before as last_delta
from public.contest_ratings cr
join public.contests c on c.id = cr.contest_id
order by cr.user_id, c.ends_at desc;

create function public.recompute_contest_ratings()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  n int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  delete from public.contest_ratings where true;
  create temporary table _rt (user_id uuid primary key, rating numeric not null, played int not null) on commit drop;
  create temporary table _part (user_id uuid primary key, rnk int not null, r0 numeric not null, played int not null) on commit drop;

  for c in select id from public.contests where ends_at < now() order by ends_at, id loop
    truncate _part;
    insert into _part (user_id, rnk, r0, played)
    select s.user_id, min(s.rank)::int,
           coalesce((select r.rating from _rt r where r.user_id = s.user_id), 1000),
           coalesce((select r.played from _rt r where r.user_id = s.user_id), 0)
    from public.get_contest_standings(c.id) s
    group by s.user_id;

    select count(*) into n from _part;
    if n >= 2 then
      insert into public.contest_ratings (contest_id, user_id, rank, participants, rating_before, rating_after)
      select c.id, a.user_id, a.rnk, n, round(a.r0)::int,
             round(
               a.r0 + (case when a.played < 3 then 48 else 32 end)
               * sum(
                   (case when a.rnk < b.rnk then 1.0 when a.rnk = b.rnk then 0.5 else 0.0 end)
                   - 1.0 / (1.0 + power(10.0, (b.r0 - a.r0) / 400.0))
                 ) / (n - 1)
             )::int
      from _part a
      join _part b on b.user_id <> a.user_id
      group by a.user_id, a.rnk, a.r0, a.played;

      insert into _rt (user_id, rating, played)
      select cr.user_id, cr.rating_after, p.played + 1
      from public.contest_ratings cr
      join _part p on p.user_id = cr.user_id
      where cr.contest_id = c.id
      on conflict (user_id) do update set rating = excluded.rating, played = excluded.played;
    end if;
  end loop;

  return (select count(*) from public.contest_ratings)::int;
end;
$$;

drop function public.get_global_leaderboard(integer);
drop view public.global_leaderboard;

create view public.global_leaderboard as
with first_ac as (
  select user_id, problem_id, min(created_at) as ac_at
  from public.submissions
  where kind = 'submit' and verdict = 'AC'
  group by user_id, problem_id
),
per_problem as (
  select
    sp.user_id,
    p.difficulty,
    p.tags,
    sp.solved_at,
    (
      select count(*)
      from public.submissions s
      where s.user_id = sp.user_id
        and s.problem_id = sp.problem_id
        and s.kind = 'submit'
        and s.verdict in ('WA', 'TLE', 'RE')
        and (fa.ac_at is null or s.created_at < fa.ac_at)
    ) as wrong,
    row_number() over (partition by sp.user_id, p.difficulty order by sp.solved_at, sp.problem_id) - 1 as nth
  from public.solved_problems sp
  join public.problems p on p.id = sp.problem_id
  left join first_ac fa on fa.user_id = sp.user_id and fa.problem_id = sp.problem_id
),
topics as (
  select
    pp.user_id,
    count(distinct case t when 'dp' then 'dynamic-programming' when 'graphs' then 'graph' else t end) as topic_count
  from per_problem pp, unnest(pp.tags) as t
  where t not in ('misc', 'striver-sde-sheet') and t not like 'day-%'
  group by pp.user_id
),
agg as (
  select
    pp.user_id,
    count(*)::int as solved_count,
    count(*) filter (where pp.wrong = 0)::int as first_try_count,
    coalesce(max(tp.topic_count), 0)::int as topic_count,
    round(
      sum(
        (case pp.difficulty when 'starter' then 5 when 'easy' then 10 when 'medium' then 25 else 50 end)
        * greatest(0.5, 1.1 - 0.1 * pp.wrong)
        * (1.0 / (1.0 + 0.03 * pp.nth))
        * (case
             when extract(epoch from (now() - pp.solved_at)) / 86400.0 <= 180 then 1.0
             else greatest(0.5, 1.0 - (extract(epoch from (now() - pp.solved_at)) / 86400.0 - 180) / 365.0)
           end)
      ) + 5 * least(coalesce(max(tp.topic_count), 0), 15)
    )::int as practice_score
  from per_problem pp
  left join topics tp on tp.user_id = pp.user_id
  group by pp.user_id
),
people as (
  select user_id from agg
  union
  select user_id from public.user_contest_rating
),
scored as (
  select
    pe.user_id,
    pr.username,
    pr.name,
    pr.country_code,
    coalesce(a.solved_count, 0) as solved_count,
    coalesce(a.first_try_count, 0) as first_try_count,
    coalesce(a.topic_count, 0) as topic_count,
    coalesce(a.practice_score, 0) as practice_score,
    ucr.rating as contest_rating,
    coalesce(ucr.contests_played, 0) as contests_played,
    ucr.last_delta as contest_last_delta,
    coalesce(a.practice_score, 0) + greatest(0, coalesce(ucr.rating, 1000) - 1000) as score
  from people pe
  join public.profiles pr on pr.id = pe.user_id
  left join agg a on a.user_id = pe.user_id
  left join public.user_contest_rating ucr on ucr.user_id = pe.user_id
)
select
  s.user_id, s.username, s.name, s.country_code,
  s.solved_count, s.first_try_count, s.topic_count,
  s.practice_score, s.contest_rating, s.contests_played, s.contest_last_delta,
  s.score,
  rank() over (order by s.score desc, s.solved_count desc) as rank
from scored s;

create function public.get_global_leaderboard(p_limit integer default 100)
returns setof public.global_leaderboard
language sql
stable
security definer
set search_path = public
as $$
  select * from public.global_leaderboard order by rank asc, solved_count desc, username limit p_limit;
$$;

create or replace function public.my_rank()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select rank::int from public.global_leaderboard where user_id = auth.uid();
$$;
