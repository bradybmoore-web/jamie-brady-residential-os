-- =============================================================================
-- Jamie & Brady Residential OS — complete database setup
--
-- GENERATED FILE. Do not edit by hand: run `npm run db:build-setup`.
-- Source of truth is supabase/migrations/, applied here in numerical order:
--   0001_init.sql
--   0002_rls.sql
--   0003_approved_team_members.sql
--   0004_integration_accounts.sql
--   0005_profile_provenance.sql
--   0006_allowlist_normalisation.sql
--
-- Paste the whole thing into the Supabase SQL editor and run it once. It is
-- safe to run again: every statement is written to be idempotent or to fail
-- loudly rather than half-apply.
-- =============================================================================

-- --------------------------------------------------------------------------
-- 0001_init.sql
-- --------------------------------------------------------------------------

-- Jamie & Brady Residential OS — core schema
-- Postgres / Supabase. UUID primary keys, created_at / updated_at everywhere,
-- source_system + source_id on anything that can originate outside the app.

create extension if not exists "pgcrypto";

-- Keep updated_at honest without application help.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  create type source_system as enum (
    'manual','seed','cloze','gmail','google_calendar','activepipe','mls','zapier','ai'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type urgency_level as enum ('low','medium','high','critical');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type approval_status as enum ('draft','needs_review','approved','executed','rejected');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type contact_type as enum ('lead','active_buyer','active_seller','past_client','sphere','agent','vendor');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type contact_stage as enum ('new','nurture','active','under_contract','closed','dormant');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type lead_stage as enum (
    'new','attempted_contact','connected','nurture','active_buyer','active_seller',
    'appointment_set','converted','closed','lost'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type lead_type as enum ('buyer','seller','investor','renter','unknown');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type listing_status as enum (
    'pre_listing','coming_soon','active','price_change','pending','closed','withdrawn'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type property_type as enum ('single_family','condo','townhome','lot','multi_family','ranch');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type task_status as enum ('open','done','snoozed','cancelled');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type task_category as enum (
    'follow_up','marketing','seller_update','showing_feedback','transaction','admin','prospecting'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type appointment_type as enum (
    'listing_appointment','showing','buyer_consult','closing','open_house',
    'inspection','photography','internal','personal'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type opportunity_kind as enum (
    'relationship','buyer_match','seller_signal','listing_action','database_mining'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type outreach_channel as enum ('call','text','email','in_person','handwritten_note');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type ai_workflow as enum (
    'daily_command_center','analyze_lead','identify_follow_up_opportunities',
    'listing_marketing','seller_update','appointment_prep','assistant'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type ai_action_type as enum (
    'email_draft','text_draft','task_suggestion','marketing_content','seller_update','stage_change','note'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type integration_status as enum ('connected','needs_setup','planned');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type transaction_side as enum ('listing','buyer','dual');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type transaction_status as enum (
    'under_contract','option_period','financing','clear_to_close','closed','terminated'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type email_engagement_type as enum (
    'email_open','email_click','campaign_response','property_click','email_received','email_sent'
  );
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------------ profiles
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'agent' check (role in ('agent','admin','assistant')),
  title text,
  phone text,
  license_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------ contacts cache
-- Cloze remains the system of record. This is a cache we can query and score
-- against; writes back to Cloze go through the integration adapter.
create table if not exists public.contacts_cache (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  type contact_type not null default 'sphere',
  stage contact_stage not null default 'nurture',
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tags text[] not null default '{}',
  city text,
  neighborhood text,
  last_personal_contact_at timestamptz,
  last_personal_contact_channel text,
  last_touch_at timestamptz,
  anniversary_at date,
  home_purchase_date date,
  home_address text,
  cloze_id text,
  do_not_contact boolean not null default false,
  is_seed boolean not null default false,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_cache_owner_idx on public.contacts_cache (owner_id);
create index if not exists contacts_cache_type_idx on public.contacts_cache (type);
create index if not exists contacts_cache_last_personal_idx on public.contacts_cache (last_personal_contact_at);
create unique index if not exists contacts_cache_cloze_idx on public.contacts_cache (cloze_id) where cloze_id is not null;

create table if not exists public.contact_notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts_cache(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contact_notes_contact_idx on public.contact_notes (contact_id);

-- Something a person said they intend to do, and when it should resurface.
create table if not exists public.stated_plans (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts_cache(id) on delete cascade,
  statement text not null,
  stated_at timestamptz not null,
  matures_at timestamptz not null,
  status text not null default 'open' check (status in ('open','acted','dismissed')),
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stated_plans_matures_idx on public.stated_plans (matures_at) where status = 'open';

-- --------------------------------------------------------------------- leads
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  source text not null,
  inquired_at timestamptz not null default now(),
  inquiry_content text not null default '',
  type lead_type not null default 'unknown',
  property_address text,
  desired_area text,
  price_range_min numeric,
  price_range_max numeric,
  estimated_timeline text,
  urgency urgency_level not null default 'medium',
  score int not null default 0 check (score between 0 and 100),
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  stage lead_stage not null default 'new',
  ai_summary text,
  ai_recommended_action text,
  drafted_response text,
  cloze_id text,
  contact_id uuid references public.contacts_cache(id) on delete set null,
  last_attempt_at timestamptz,
  attempt_count int not null default 0,
  follow_up_due_at timestamptz,
  analysis_run_id uuid,
  is_seed boolean not null default false,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_assigned_idx on public.leads (assigned_to);
create index if not exists leads_stage_idx on public.leads (stage);
create index if not exists leads_follow_up_idx on public.leads (follow_up_due_at) where stage not in ('converted','closed','lost');

-- ---------------------------------------------------------------- properties
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  city text not null,
  state text not null default 'TX',
  postal_code text not null,
  neighborhood text,
  county text,
  beds numeric,
  baths numeric,
  half_baths numeric,
  square_feet int,
  lot_size_acres numeric,
  year_built int,
  property_type property_type not null default 'single_family',
  mls_number text,
  subdivision text,
  school_district text,
  elementary_school text,
  middle_school text,
  high_school text,
  has_pool boolean not null default false,
  stories int,
  image_urls text[] not null default '{}',
  latitude numeric,
  longitude numeric,
  is_seed boolean not null default false,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists properties_mls_idx on public.properties (mls_number) where mls_number is not null;

-- ------------------------------------------------------------------ listings
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  status listing_status not null default 'pre_listing',
  list_price numeric not null,
  original_list_price numeric not null,
  listed_at timestamptz,
  launch_date date,
  contract_date date,
  close_date date,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  seller_contact_ids uuid[] not null default '{}',
  seller_names text not null default '',
  open_house_dates timestamptz[] not null default '{}',
  major_features text[] not null default '{}',
  improvements text[] not null default '{}',
  neighborhood_amenities text[] not null default '{}',
  lifestyle_points text[] not null default '{}',
  nearby_destinations text[] not null default '{}',
  positioning text not null default '',
  writing_notes text not null default '',
  prohibited_phrases text[] not null default '{}',
  brokerage_disclaimer text not null default '',
  seller_update_cadence_days int not null default 7,
  last_seller_update_at timestamptz,
  showings_this_week int not null default 0,
  total_showings int not null default 0,
  inquiries_this_week int not null default 0,
  portal_views_this_week int not null default 0,
  saves_this_week int not null default 0,
  last_activity_at timestamptz,
  last_activity_summary text,
  is_seed boolean not null default false,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists listings_owner_idx on public.listings (owner_id);
create index if not exists listings_status_idx on public.listings (status);

create table if not exists public.showing_feedback (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  showing_at timestamptz not null,
  agent_name text not null default '',
  buyer_impression text not null default 'neutral'
    check (buyer_impression in ('positive','neutral','negative')),
  price_reaction text not null default 'unstated'
    check (price_reaction in ('under','fair','over','unstated')),
  comments text not null default '',
  is_seed boolean not null default false,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists showing_feedback_listing_idx on public.showing_feedback (listing_id, showing_at desc);

-- ------------------------------------------------------------ seller updates
create table if not exists public.seller_updates (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  due_at timestamptz not null,
  status approval_status not null default 'needs_review',
  facts text[] not null default '{}',
  market_interpretation text not null default '',
  recommended_action text not null default '',
  draft_message text not null default '',
  market_context jsonb not null default '{}'::jsonb,
  feedback_ids uuid[] not null default '{}',
  ai_run_id uuid,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  is_seed boolean not null default false,
  source_system source_system not null default 'ai',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists seller_updates_listing_idx on public.seller_updates (listing_id, due_at desc);

-- -------------------------------------------------------------------- buyers
create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts_cache(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  target_locations text[] not null default '{}',
  price_min numeric not null default 0,
  price_max numeric not null default 0,
  min_beds numeric not null default 0,
  min_baths numeric not null default 0,
  preferred_square_feet int,
  lot_preference text,
  pool_preference text not null default 'neutral'
    check (pool_preference in ('required','preferred','neutral','avoid')),
  view_preference text,
  privacy_preference text,
  architectural_styles text[] not null default '{}',
  schools text[] not null default '{}',
  commute_notes text,
  primary_bedroom_preference text,
  one_story_preference text not null default 'neutral'
    check (one_story_preference in ('required','preferred','neutral','no')),
  deal_breakers text[] not null default '{}',
  must_haves text[] not null default '{}',
  nice_to_haves text[] not null default '{}',
  emotional_reactions text[] not null default '{}',
  preferred_property_ids uuid[] not null default '{}',
  rejected_property_ids uuid[] not null default '{}',
  rejection_reasons jsonb not null default '[]'::jsonb,
  pre_approved boolean not null default false,
  lender_name text,
  timeline text,
  last_showing_at timestamptz,
  is_seed boolean not null default false,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists buyers_owner_idx on public.buyers (owner_id) where active;

-- -------------------------------------------------------------- transactions
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  property_id uuid not null references public.properties(id) on delete cascade,
  side transaction_side not null,
  status transaction_status not null default 'under_contract',
  client_contact_ids uuid[] not null default '{}',
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contract_price numeric not null,
  contract_date date not null,
  option_ends_at timestamptz,
  financing_deadline_at timestamptz,
  appraisal_due_at timestamptz,
  close_date date not null,
  title_company text,
  lender text,
  milestones jsonb not null default '[]'::jsonb,
  is_seed boolean not null default false,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transactions_owner_idx on public.transactions (owner_id, close_date);

-- --------------------------------------------------------------------- tasks
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  detail text,
  category task_category not null default 'follow_up',
  status task_status not null default 'open',
  due_at timestamptz not null,
  completed_at timestamptz,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid references public.contacts_cache(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete cascade,
  urgency urgency_level not null default 'medium',
  created_by_ai boolean not null default false,
  ai_run_id uuid,
  is_seed boolean not null default false,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_owner_due_idx on public.tasks (owner_id, due_at) where status = 'open';

-- ------------------------------------------------------- calendar / email cache
create table if not exists public.calendar_events_cache (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type appointment_type not null default 'internal',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contact_ids uuid[] not null default '{}',
  listing_id uuid references public.listings(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  notes text,
  prep_status text not null default 'not_started'
    check (prep_status in ('not_started','prepared','not_needed')),
  prep_brief_id uuid,
  is_seed boolean not null default false,
  source_system source_system not null default 'google_calendar',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists calendar_events_owner_start_idx on public.calendar_events_cache (owner_id, starts_at);

create table if not exists public.email_events_cache (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts_cache(id) on delete cascade,
  contact_email text not null,
  type email_engagement_type not null,
  occurred_at timestamptz not null,
  subject text,
  campaign_name text,
  property_address text,
  thread_id text,
  awaiting_reply boolean not null default false,
  snippet text,
  is_seed boolean not null default false,
  source_system source_system not null default 'activepipe',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_events_contact_idx on public.email_events_cache (contact_id, occurred_at desc);
create index if not exists email_events_awaiting_idx on public.email_events_cache (awaiting_reply) where awaiting_reply;

-- ------------------------------------------------------------- opportunities
create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  kind opportunity_kind not null default 'relationship',
  contact_id uuid references public.contacts_cache(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  why_now text not null,
  supporting_evidence jsonb not null default '[]'::jsonb,
  recommended_channel outreach_channel not null default 'call',
  recommended_action text not null,
  suggested_conversation_starter text not null default '',
  confidence numeric not null default 0.5 check (confidence between 0 and 1),
  score int not null default 0,
  urgency urgency_level not null default 'medium',
  status text not null default 'open' check (status in ('open','acted','dismissed','snoozed')),
  snoozed_until timestamptz,
  ai_run_id uuid,
  is_seed boolean not null default false,
  source_system source_system not null default 'ai',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists opportunities_owner_score_idx on public.opportunities (owner_id, score desc) where status = 'open';

-- ----------------------------------------------------------------- ai audit
create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  workflow ai_workflow not null,
  prompt_version text not null,
  model text not null,
  provider text not null check (provider in ('anthropic','mock')),
  input_record_ids jsonb not null default '[]'::jsonb,
  status text not null default 'success' check (status in ('success','error')),
  latency_ms int not null default 0,
  tokens_in int,
  tokens_out int,
  error text,
  output_summary text not null default '',
  started_at timestamptz not null default now(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  is_seed boolean not null default false,
  source_system source_system not null default 'ai',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_runs_workflow_idx on public.ai_runs (workflow, started_at desc);

create table if not exists public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  ai_run_id uuid not null references public.ai_runs(id) on delete cascade,
  workflow ai_workflow not null,
  type ai_action_type not null,
  status approval_status not null default 'needs_review',
  title text not null,
  body text not null default '',
  subject text,
  recipient text,
  contact_id uuid references public.contacts_cache(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  listing_id uuid references public.listings(id) on delete set null,
  confidence numeric not null default 0.5 check (confidence between 0 and 1),
  evidence jsonb not null default '[]'::jsonb,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  executed_at timestamptz,
  rejection_reason text,
  -- What actually happened on execution (e.g. "draft created in Gmail" vs
  -- "Gmail not connected"). Recorded so the distinction survives the page load.
  delivery_note text,
  requires_approval boolean not null default true,
  is_seed boolean not null default false,
  source_system source_system not null default 'ai',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_actions_status_idx on public.ai_actions (owner_id, status, created_at desc);

-- Outbound communication must never be auto-executed.
do $$ begin
  alter table public.ai_actions
    add constraint ai_actions_outbound_requires_approval
    check (requires_approval or type not in ('email_draft','text_draft','stage_change'));
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------- listing marketing
create table if not exists public.listing_marketing (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  kind text not null,
  status approval_status not null default 'draft',
  content text not null default '',
  prompt_version text not null default '',
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  approved_at timestamptz,
  flagged_phrases text[] not null default '{}',
  is_seed boolean not null default false,
  source_system source_system not null default 'ai',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists listing_marketing_listing_idx on public.listing_marketing (listing_id, kind);

-- Photography, floor plans, video files — pointers only, no binaries in Postgres.
create table if not exists public.marketing_assets (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  label text not null,
  asset_type text not null check (asset_type in ('photo','video','floor_plan','document','other')),
  url text not null,
  sort_order int not null default 0,
  is_seed boolean not null default false,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_assets_listing_idx on public.marketing_assets (listing_id, sort_order);

-- ------------------------------------------------------------- daily briefs
create table if not exists public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  top_priorities jsonb not null default '[]'::jsonb,
  people_needing_attention jsonb not null default '[]'::jsonb,
  appointments uuid[] not null default '{}',
  leads uuid[] not null default '{}',
  listing_actions jsonb not null default '[]'::jsonb,
  seller_updates uuid[] not null default '{}',
  opportunities uuid[] not null default '{}',
  warnings text[] not null default '{}',
  metrics jsonb not null default '{}'::jsonb,
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  is_seed boolean not null default false,
  source_system source_system not null default 'ai',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, owner_id)
);

create table if not exists public.appointment_preps (
  id uuid primary key default gen_random_uuid(),
  calendar_event_id uuid not null references public.calendar_events_cache(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contact_summary text not null default '',
  recent_communication text[] not null default '{}',
  known_goals text[] not null default '{}',
  prior_notes text[] not null default '{}',
  related_listing_id uuid references public.listings(id) on delete set null,
  related_property_id uuid references public.properties(id) on delete set null,
  outstanding_questions text[] not null default '{}',
  talking_points text[] not null default '{}',
  evidence jsonb not null default '[]'::jsonb,
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  is_seed boolean not null default false,
  source_system source_system not null default 'ai',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------------- integrations
create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  status integration_status not null default 'planned',
  connected_at timestamptz,
  last_sync_at timestamptz,
  account_label text,
  scopes text[] not null default '{}',
  error text,
  is_seed boolean not null default false,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ audit log
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_type text not null default 'user' check (actor_type in ('user','ai','system')),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);

-- --------------------------------------------------------------- updated_at
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','contacts_cache','contact_notes','stated_plans','leads','properties','listings',
    'showing_feedback','seller_updates','buyers','transactions','tasks','calendar_events_cache',
    'email_events_cache','opportunities','ai_runs','ai_actions','listing_marketing',
    'marketing_assets','daily_briefs','appointment_preps','integration_connections','audit_log'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end;
$$;

-- --------------------------------------------------------------------------
-- 0002_rls.sql
-- --------------------------------------------------------------------------

-- Row level security.
--
-- Model: this is a two-person brokerage team. Both agents are trusted with the
-- whole book of business, so the rule is "any authenticated team member with a
-- profile can read and write", not per-record ownership walls. That is a
-- deliberate simplification — the brief explicitly says not to build
-- complicated permissions. Ownership is still recorded on every row via
-- owner_id/assigned_to so tighter policies can be layered on later without a
-- schema change.
--
-- The service role key bypasses RLS and is only ever used server-side.

create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.user_id = auth.uid()
  );
$$;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p where p.user_id = auth.uid() limit 1;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'contacts_cache','contact_notes','stated_plans','leads','properties','listings',
    'showing_feedback','seller_updates','buyers','transactions','tasks','calendar_events_cache',
    'email_events_cache','opportunities','ai_runs','ai_actions','listing_marketing',
    'marketing_assets','daily_briefs','appointment_preps','integration_connections'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_team_member())',
      t || '_select', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_team_member())',
      t || '_insert', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_team_member()) with check (public.is_team_member())',
      t || '_update', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_team_member())',
      t || '_delete', t
    );
  end loop;
end;
$$;

-- Profiles: you may read the team, but only edit yourself.
alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.is_team_member());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Audit log: append-only from the application's point of view. No update or
-- delete policy exists, so those operations are denied for every authenticated
-- role regardless of what the application asks for.
alter table public.audit_log enable row level security;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_team_member());

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (public.is_team_member());

-- New auth users get a profile automatically so RLS lets them in on first load.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------------------
-- 0003_approved_team_members.sql
-- --------------------------------------------------------------------------

-- Explicit authorization.
--
-- Migration 0002 granted access to anyone holding a row in `profiles`, and
-- `handle_new_user` created that row for every new auth user. Supabase projects
-- allow public email signup by default, so the combination meant that anyone
-- who could reach the signup endpoint could read the entire book of business.
--
-- This migration makes authorization explicit and deny-by-default:
--
--   * `profiles.approved` defaults to FALSE. An unapproved profile sees nothing.
--   * `allowed_team_emails` is an allowlist. Signing up with an address on it
--     approves the profile automatically; signing up with any other address
--     creates an unapproved profile that cannot read a single row.
--   * A signed-in user cannot approve themselves. Column-level grants prevent
--     `approved` from being written by the `authenticated` role at all, and the
--     row policies refuse it a second time.
--
-- Bootstrapping is a deliberate, manual act performed with the service role or
-- the SQL editor. See README -> "Authorizing team members".

/* ------------------------------------------------------------- allowlist */

create table if not exists public.allowed_team_emails (
  -- Always stored lowercase; the trigger and the constraint both fold case.
  email text primary key check (email = lower(email)),
  note text,
  created_at timestamptz not null default now()
);

alter table public.allowed_team_emails enable row level security;

-- Approved members may see who else is permitted. Nobody using the anon or
-- authenticated role may modify it: there is no insert, update or delete
-- policy, so those operations are denied regardless of grants. Changing the
-- allowlist requires the service role or direct SQL access.
drop policy if exists allowed_team_emails_select on public.allowed_team_emails;
create policy allowed_team_emails_select on public.allowed_team_emails
  for select to authenticated
  using (public.is_team_member());

/* ----------------------------------------------------- profiles.approved */

alter table public.profiles
  add column if not exists approved boolean not null default false,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null;

create index if not exists profiles_approved_idx on public.profiles (approved) where approved;

/* -------------------------------------------------- deny-by-default gate */

-- Redefining this function re-secures every policy written in 0002, since they
-- all call it. Access now requires an approved profile, not merely any profile.
create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.approved
  );
$$;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.user_id = auth.uid()
    and p.approved
  limit 1;
$$;

/* ------------------------------------------- signup cannot self-authorize */

-- Column-level privileges: the `authenticated` role may never write `approved`,
-- `approved_at`, `approved_by`, `user_id` or `email`. Supabase grants ALL on
-- public tables to `authenticated` by default, so these have to be revoked
-- before the narrower grants are issued.
revoke insert, update on public.profiles from authenticated;
grant insert (user_id, full_name, email) on public.profiles to authenticated;
grant update (full_name, title, phone, license_number) on public.profiles to authenticated;

-- Belt and braces: even if a future grant were widened by mistake, the row
-- policy still refuses a self-inserted profile that claims to be approved.
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid() and approved = false);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A new auth user is approved only if their address is on the allowlist.
-- Everyone else gets an unapproved profile: it records that they signed up,
-- and it grants them nothing.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_allowed boolean;
begin
  select exists (
    select 1 from public.allowed_team_emails a
    where a.email = lower(new.email)
  ) into is_allowed;

  insert into public.profiles (user_id, full_name, email, approved, approved_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    is_allowed,
    case when is_allowed then now() else null end
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* --------------------------------------------------------------- helpers */

-- Approve someone already signed up. Intended for the SQL editor or the
-- service role. It is NOT granted to `authenticated`, so a signed-in user
-- cannot call it to approve themselves.
create or replace function public.approve_team_member(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.allowed_team_emails (email, note)
  values (lower(target_email), 'added by approve_team_member')
  on conflict (email) do nothing;

  update public.profiles
  set approved = true,
      approved_at = coalesce(approved_at, now())
  where lower(email) = lower(target_email);
end;
$$;

revoke all on function public.approve_team_member(text) from public, anon, authenticated;
-- Granted explicitly rather than relying on Supabase's default function
-- privileges, so this keeps working if those defaults ever change.
grant execute on function public.approve_team_member(text) to service_role;

-- Revoke access for someone who should no longer see client data.
create or replace function public.revoke_team_member(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.allowed_team_emails where email = lower(target_email);
  update public.profiles
  set approved = false, approved_at = null
  where lower(email) = lower(target_email);
end;
$$;

revoke all on function public.revoke_team_member(text) from public, anon, authenticated;
grant execute on function public.revoke_team_member(text) to service_role;

-- --------------------------------------------------------------------------
-- 0004_integration_accounts.sql
-- --------------------------------------------------------------------------

-- Per-person integration credentials.
--
-- Architecture for Phase 3, created now so the shape is settled and tested
-- before any real token exists. NOTHING WRITES TO THIS TABLE YET.
--
-- Why it exists: the Gmail and Calendar adapters currently read a single
-- refresh token from the environment, which would make both agents act as one
-- Google identity — Brady's session would read Jamie's mailbox. Jamie's tokens
-- must belong to Jamie's profile. This table is that ownership.
--
-- Note the distinction from `integration_connections`:
--   * integration_connections — one row per vendor, describing whether the
--     product as a whole is wired up to Cloze/Gmail/MLS. Team-visible.
--   * integration_accounts    — one row per person per vendor, holding that
--     person's credentials. Visible only to its owner, and its token columns
--     are readable by no user role at all.

create table if not exists public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('google', 'cloze', 'activepipe', 'docusign')),

  -- Which account was connected, for display ("Connected as jamie@...").
  account_email text,
  status text not null default 'disconnected'
    check (status in ('connected', 'disconnected', 'error', 'revoked')),
  scopes text[] not null default '{}',

  -- Credentials. Encrypted by the application before they are written; the
  -- database never sees a usable plaintext token. Read server-side with the
  -- service role only — see the grants below, which deny these columns to every
  -- user-facing role so a token cannot leak through an ordinary query.
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz,

  connected_at timestamptz,
  last_refreshed_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One connection per person per vendor.
  unique (profile_id, provider)
);

create index if not exists integration_accounts_profile_idx on public.integration_accounts (profile_id);

drop trigger if exists integration_accounts_touch on public.integration_accounts;
create trigger integration_accounts_touch
  before update on public.integration_accounts
  for each row execute function public.touch_updated_at();

/* ------------------------------------------------------------------ access */

alter table public.integration_accounts enable row level security;

-- Unlike every other table, this one is NOT team-wide. A connection belongs to
-- one person. Being an approved team member is necessary but not sufficient.
drop policy if exists integration_accounts_select on public.integration_accounts;
create policy integration_accounts_select on public.integration_accounts
  for select to authenticated
  using (public.is_team_member() and profile_id = public.current_profile_id());

drop policy if exists integration_accounts_insert on public.integration_accounts;
create policy integration_accounts_insert on public.integration_accounts
  for insert to authenticated
  with check (public.is_team_member() and profile_id = public.current_profile_id());

drop policy if exists integration_accounts_update on public.integration_accounts;
create policy integration_accounts_update on public.integration_accounts
  for update to authenticated
  using (public.is_team_member() and profile_id = public.current_profile_id())
  with check (public.is_team_member() and profile_id = public.current_profile_id());

-- Disconnecting is deleting your own row.
drop policy if exists integration_accounts_delete on public.integration_accounts;
create policy integration_accounts_delete on public.integration_accounts
  for delete to authenticated
  using (public.is_team_member() and profile_id = public.current_profile_id());

-- Column privileges: no user-facing role may read or write the credential
-- columns, even for its own row. Tokens are handled exclusively by server-side
-- code holding the service role, so they can never be returned to a browser by
-- an ordinary `select *`.
revoke all on public.integration_accounts from anon, authenticated;

grant select (
  id, profile_id, provider, account_email, status, scopes,
  access_token_expires_at, connected_at, last_refreshed_at, last_error,
  created_at, updated_at
) on public.integration_accounts to authenticated;

grant insert (profile_id, provider, account_email, status, scopes) on public.integration_accounts to authenticated;
grant update (account_email, status, scopes) on public.integration_accounts to authenticated;
grant delete on public.integration_accounts to authenticated;

-- --------------------------------------------------------------------------
-- 0005_profile_provenance.sql
-- --------------------------------------------------------------------------

-- Bring `profiles` in line with every other table.
--
-- Found by tests/db/schema-conformance.test.ts, which maps the TypeScript
-- domain model onto the real schema: `Profile` extends `BaseRecord`, so the
-- store writes `source_system` and `is_seed` for it as it does for every other
-- record — but migration 0001 never gave `profiles` those columns. The mismatch
-- was invisible while the app ran on MemoryStore and would have surfaced as a
-- failed insert the first time a profile was written to Postgres.
--
-- Added as a new migration rather than by editing 0001, so that any database
-- already carrying 0001 moves forward cleanly instead of silently diverging.

alter table public.profiles
  add column if not exists source_system source_system not null default 'manual',
  add column if not exists source_id text,
  add column if not exists is_seed boolean not null default false;

-- These are provenance, not authorization, but they are still not the
-- signed-in user's to rewrite: the column grants from 0003 deliberately list
-- only the display fields, and adding columns does not widen them.

-- --------------------------------------------------------------------------
-- 0006_allowlist_normalisation.sql
-- --------------------------------------------------------------------------

-- =============================================================================
-- 0006 — make allowlist matching immune to stray whitespace.
--
-- Migration 0003 stored allowlist addresses with `check (email = lower(email))`
-- and `handle_new_user` matched with `a.email = lower(new.email)`. Case was
-- therefore handled, but whitespace was not: an address pasted into the SQL
-- editor with a trailing space, or with a non-breaking space picked up from a
-- web page or a document, satisfied the constraint, sat in the table looking
-- correct, and silently failed to approve the account it was meant to approve.
--
-- This was found in production bootstrapping: one of two addresses entered in
-- the same statement approved and the other did not.
--
-- The fix is to store and compare a canonical form with all whitespace removed.
-- Note what this deliberately does NOT do: it does not ignore dots, plus
-- suffixes or any other character. Those distinguish genuinely different
-- mailboxes at some providers, and folding them would widen who an allowlist
-- entry approves. Only whitespace — which can never be part of an address a
-- Supabase account is created with — is folded away.
--
-- This migration does not approve anybody. Profiles already created stay
-- exactly as they are; approving an existing account remains a deliberate act
-- via `approve_team_member`.
-- =============================================================================

/* --------------------------------------------- canonical form of an address */

create or replace function public.normalise_email(addr text)
returns text
language sql
immutable
set search_path = public
as $$
  -- Space, tab, newline, carriage return and U+00A0 non-breaking space.
  select lower(translate(coalesce(addr, ''), E' \t\n\r\u00a0', ''));
$$;

revoke all on function public.normalise_email(text) from public, anon, authenticated;
grant execute on function public.normalise_email(text) to service_role;

/* ------------------------------------------ repair any rows already stored */

-- Drop duplicates that only differ by whitespace or case, keeping the oldest,
-- so the normalisation below cannot collide on the primary key.
delete from public.allowed_team_emails a
using public.allowed_team_emails b
where public.normalise_email(a.email) = public.normalise_email(b.email)
  and (a.created_at, a.email) > (b.created_at, b.email);

update public.allowed_team_emails
set email = public.normalise_email(email)
where email <> public.normalise_email(email);

/* ------------------------------------------------- refuse malformed entries */

alter table public.allowed_team_emails
  drop constraint if exists allowed_team_emails_email_check;

do $$ begin
  alter table public.allowed_team_emails
    add constraint allowed_team_emails_canonical
    -- The normalisation is inlined rather than calling normalise_email(), so
    -- the constraint carries no dependency on a function that a dump/restore
    -- might not have created yet.
    check (
      email = lower(translate(email, E' \t\n\r\u00a0', ''))
      and position('@' in email) > 1
      and position('@' in email) < length(email)
    );
exception when duplicate_object then null;
end $$;

/* ------------------------------------------------------ matching at signup */

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_allowed boolean;
begin
  select exists (
    select 1 from public.allowed_team_emails a
    where a.email = public.normalise_email(new.email)
  ) into is_allowed;

  insert into public.profiles (user_id, full_name, email, approved, approved_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    is_allowed,
    case when is_allowed then now() else null end
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* -------------------------------------------------- approve / revoke by hand */

create or replace function public.approve_team_member(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical text := public.normalise_email(target_email);
begin
  if position('@' in canonical) < 2 then
    raise exception 'not an email address';
  end if;

  insert into public.allowed_team_emails (email, note)
  values (canonical, 'added by approve_team_member')
  on conflict (email) do nothing;

  update public.profiles
  set approved = true,
      approved_at = coalesce(approved_at, now())
  where public.normalise_email(email) = canonical;
end;
$$;

revoke all on function public.approve_team_member(text) from public, anon, authenticated;
grant execute on function public.approve_team_member(text) to service_role;

create or replace function public.revoke_team_member(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical text := public.normalise_email(target_email);
begin
  delete from public.allowed_team_emails where email = canonical;
  update public.profiles
  set approved = false, approved_at = null
  where public.normalise_email(email) = canonical;
end;
$$;

revoke all on function public.revoke_team_member(text) from public, anon, authenticated;
grant execute on function public.revoke_team_member(text) to service_role;

-- =============================================================================
-- Setup complete. Next: add the two permitted addresses to the allowlist with
-- supabase/setup/02-allowlist.sql, then create those two users in
-- Authentication -> Users. Signing up does not grant access; being allowlisted
-- at the moment the account is created does.
-- =============================================================================
