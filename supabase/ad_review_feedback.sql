-- Stores submissions from the ad review boards (app/api/ad-review-feedback).
-- Written by the API route with the service role key; no public policies.
create table if not exists public.ad_review_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  campaign text not null,
  business text,
  reviewer text,
  payload jsonb not null
);
alter table public.ad_review_feedback enable row level security;
create index if not exists ad_review_feedback_campaign_idx
  on public.ad_review_feedback (campaign, created_at desc);
