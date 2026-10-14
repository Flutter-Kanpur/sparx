-- System design practice: each user's saved answer per question.
--
-- How to apply: Supabase project → SQL Editor → paste this whole file → Run.
-- Safe to run once, after 0001-0020. Purely additive.
--
-- The questions themselves live in the app (src/design/questions.js). Until this is
-- applied the feature still works: answers are kept in the browser (localStorage).

create table public.design_answers (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  question_id  text not null,
  sections     jsonb not null default '{}',
  self_check   jsonb not null default '{}',
  hints_shown  int not null default 0,
  revealed     boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.design_answers enable row level security;

create policy "users manage their own design answers"
  on public.design_answers for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
