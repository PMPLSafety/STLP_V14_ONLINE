-- STLP Assessment Module
-- Run ONCE in Supabase SQL Editor after the existing STLP database.
-- Do not rerun the original database setup.

create extension if not exists pgcrypto;

create table if not exists public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.trainings(id) on delete cascade,
  question_no integer not null default 1,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_option text not null check (correct_option in ('A','B','C','D')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assessment_questions_training_idx
on public.assessment_questions(training_id, question_no);

create table if not exists public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.trainings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  passed boolean not null default false,
  total_questions integer not null default 0,
  correct_answers integer not null default 0,
  retry_allowed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists assessment_attempts_user_idx
on public.assessment_attempts(user_id, training_id, created_at desc);

alter table public.assessment_questions enable row level security;
alter table public.assessment_attempts enable row level security;

drop policy if exists assessment_questions_admin_all on public.assessment_questions;
create policy assessment_questions_admin_all
on public.assessment_questions for all
to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

drop policy if exists assessment_questions_user_read on public.assessment_questions;
create policy assessment_questions_user_read
on public.assessment_questions for select
to authenticated
using (
  exists (
    select 1 from public.trainings t
    where t.id=assessment_questions.training_id
      and t.published=true
      and t.archived=false
      and t.assessment_required=true
  )
);

drop policy if exists assessment_attempts_user_all on public.assessment_attempts;
create policy assessment_attempts_user_all
on public.assessment_attempts for all
to authenticated
using (user_id=auth.uid())
with check (user_id=auth.uid());

drop policy if exists assessment_attempts_admin_all on public.assessment_attempts;
create policy assessment_attempts_admin_all
on public.assessment_attempts for all
to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

-- Optional helper for Admin to manually allow another attempt:
-- UPDATE public.assessment_attempts
-- SET retry_allowed=true
-- WHERE id='FAILED_ATTEMPT_UUID';
