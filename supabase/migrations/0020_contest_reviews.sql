-- AI contest reviews.
--
-- How to apply: Supabase project → SQL Editor → paste this whole file → Run.
-- Safe to run once, after 0001-0019. Purely additive.
--
--   contest_reviews       the feedback a participant sees about their own contest
--                         (readable by that user and by admins)
--   contest_review_flags  organiser-only "originality" signals (rewrite size between
--                         attempts, similarity to other participants) and a one-line
--                         note. Admin-only: these are hints for a human, never shown
--                         to the participant.
--
-- Rows are written only by the relay server (service role) — there are no insert/update
-- policies, so browsers cannot write or forge reviews.

create table public.contest_reviews (
  contest_id  uuid not null references public.contests(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  review      jsonb not null,
  model       text,
  created_at  timestamptz not null default now(),
  primary key (contest_id, user_id)
);

alter table public.contest_reviews enable row level security;

create policy "users see own contest review, admins see all"
  on public.contest_reviews for select
  using (auth.uid() = user_id or public.is_admin());

create table public.contest_review_flags (
  contest_id  uuid not null references public.contests(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  signals     jsonb not null default '[]',
  admin_note  text,
  created_at  timestamptz not null default now(),
  primary key (contest_id, user_id)
);

alter table public.contest_review_flags enable row level security;

create policy "admins see review flags"
  on public.contest_review_flags for select
  using (public.is_admin());
