-- Per-question timers for contests.
--
-- How to apply: Supabase project → SQL Editor → paste this whole file → Run.
-- Safe to run once, after 0001-0018. Purely additive: it does NOT change the
-- standings or how anyone is ranked.
--
-- A user's clock for a question starts the first time they open it in the
-- contest workspace (recorded by start_contest_problem). The workspace shows a
-- running timer per question and, once solved, how long it took.

create table public.contest_problem_starts (
  contest_id  uuid not null references public.contests(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  problem_id  text not null references public.problems(id) on delete cascade,
  started_at  timestamptz not null default now(),
  primary key (contest_id, user_id, problem_id)
);

alter table public.contest_problem_starts enable row level security;

create policy "users see own problem starts, admins see all"
  on public.contest_problem_starts for select
  using (auth.uid() = user_id or public.is_admin());

-- Records (once) when the caller opened a contest question; returns the stored
-- start time, or null if they may not start it (contest not live, no access).
create function public.start_contest_problem(p_contest_id uuid, p_problem_id text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  t timestamptz;
begin
  if auth.uid() is null then
    return null;
  end if;
  if not exists (
    select 1
    from public.contests c
    join public.contest_problems cp on cp.contest_id = c.id
    where c.id = p_contest_id
      and cp.problem_id = p_problem_id
      and now() between c.starts_at and c.ends_at
  ) then
    return null;
  end if;
  if not public.has_contest_access(p_contest_id) then
    return null;
  end if;
  insert into public.contest_problem_starts (contest_id, user_id, problem_id)
  values (p_contest_id, auth.uid(), p_problem_id)
  on conflict do nothing;
  select s.started_at into t
  from public.contest_problem_starts s
  where s.contest_id = p_contest_id and s.user_id = auth.uid() and s.problem_id = p_problem_id;
  return t;
end;
$$;
