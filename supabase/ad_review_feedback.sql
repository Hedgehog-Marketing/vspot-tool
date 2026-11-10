-- Stores submissions from the ad review boards (app/api/ad-review-feedback).
-- Applied to the hedgehog-master project. The API route uses the publishable
-- (anon) key, which can INSERT only: no select, update or delete.
create table if not exists public.ad_review_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  campaign text not null check (char_length(campaign) <= 120),
  business text,
  reviewer text,
  payload jsonb not null check (pg_column_size(payload) <= 200000)
);
alter table public.ad_review_feedback enable row level security;
create index if not exists ad_review_feedback_campaign_idx
  on public.ad_review_feedback (campaign, created_at desc);
create policy "anon can insert feedback" on public.ad_review_feedback
  for insert to anon with check (true);
revoke all on public.ad_review_feedback from anon;
grant insert on public.ad_review_feedback to anon;
