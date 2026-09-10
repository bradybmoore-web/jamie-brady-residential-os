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

create type source_system as enum (
  'manual','seed','cloze','gmail','google_calendar','activepipe','mls','zapier','ai'
);
create type urgency_level as enum ('low','medium','high','critical');
create type approval_status as enum ('draft','needs_review','approved','executed','rejected');
create type contact_type as enum ('lead','active_buyer','active_seller','past_client','sphere','agent','vendor');
create type contact_stage as enum ('new','nurture','active','under_contract','closed','dormant');
create type lead_stage as enum (
  'new','attempted_contact','connected','nurture','active_buyer','active_seller',
  'appointment_set','converted','closed','lost'
);
create type lead_type as enum ('buyer','seller','investor','renter','unknown');
create type listing_status as enum (
  'pre_listing','coming_soon','active','price_change','pending','closed','withdrawn'
);
create type property_type as enum ('single_family','condo','townhome','lot','multi_family','ranch');
create type task_status as enum ('open','done','snoozed','cancelled');
create type task_category as enum (
  'follow_up','marketing','seller_update','showing_feedback','transaction','admin','prospecting'
);
create type appointment_type as enum (
  'listing_appointment','showing','buyer_consult','closing','open_house',
  'inspection','photography','internal','personal'
);
create type opportunity_kind as enum (
  'relationship','buyer_match','seller_signal','listing_action','database_mining'
);
create type outreach_channel as enum ('call','text','email','in_person','handwritten_note');
create type ai_workflow as enum (
  'daily_command_center','analyze_lead','identify_follow_up_opportunities',
  'listing_marketing','seller_update','appointment_prep','assistant'
);
create type ai_action_type as enum (
  'email_draft','text_draft','task_suggestion','marketing_content','seller_update','stage_change','note'
);
create type integration_status as enum ('connected','needs_setup','planned');
create type transaction_side as enum ('listing','buyer','dual');
create type transaction_status as enum (
  'under_contract','option_period','financing','clear_to_close','closed','terminated'
);
create type email_engagement_type as enum (
  'email_open','email_click','campaign_response','property_click','email_received','email_sent'
);

-- ------------------------------------------------------------------ profiles
create table public.profiles (
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
create table public.contacts_cache (
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
create index contacts_cache_owner_idx on public.contacts_cache (owner_id);
create index contacts_cache_type_idx on public.contacts_cache (type);
create index contacts_cache_last_personal_idx on public.contacts_cache (last_personal_contact_at);
create unique index contacts_cache_cloze_idx on public.contacts_cache (cloze_id) where cloze_id is not null;

create table public.contact_notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts_cache(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  source_system source_system not null default 'manual',
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contact_notes_contact_idx on public.contact_notes (contact_id);

-- Something a person said they intend to do, and when it should resurface.
create table public.stated_plans (
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
create index stated_plans_matures_idx on public.stated_plans (matures_at) where status = 'open';

-- --------------------------------------------------------------------- leads
create table public.leads (
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
create index leads_assigned_idx on public.leads (assigned_to);
create index leads_stage_idx on public.leads (stage);
create index leads_follow_up_idx on public.leads (follow_up_due_at) where stage not in ('converted','closed','lost');

-- ---------------------------------------------------------------- properties
create table public.properties (
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
create unique index properties_mls_idx on public.properties (mls_number) where mls_number is not null;

-- ------------------------------------------------------------------ listings
create table public.listings (
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
create index listings_owner_idx on public.listings (owner_id);
create index listings_status_idx on public.listings (status);

create table public.showing_feedback (
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
create index showing_feedback_listing_idx on public.showing_feedback (listing_id, showing_at desc);

-- ------------------------------------------------------------ seller updates
create table public.seller_updates (
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
create index seller_updates_listing_idx on public.seller_updates (listing_id, due_at desc);

-- -------------------------------------------------------------------- buyers
create table public.buyers (
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
create index buyers_owner_idx on public.buyers (owner_id) where active;

-- -------------------------------------------------------------- transactions
create table public.transactions (
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
create index transactions_owner_idx on public.transactions (owner_id, close_date);

-- --------------------------------------------------------------------- tasks
create table public.tasks (
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
create index tasks_owner_due_idx on public.tasks (owner_id, due_at) where status = 'open';

-- ------------------------------------------------------- calendar / email cache
create table public.calendar_events_cache (
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
create index calendar_events_owner_start_idx on public.calendar_events_cache (owner_id, starts_at);

create table public.email_events_cache (
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
create index email_events_contact_idx on public.email_events_cache (contact_id, occurred_at desc);
create index email_events_awaiting_idx on public.email_events_cache (awaiting_reply) where awaiting_reply;

-- ------------------------------------------------------------- opportunities
create table public.opportunities (
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
create index opportunities_owner_score_idx on public.opportunities (owner_id, score desc) where status = 'open';

-- ----------------------------------------------------------------- ai audit
create table public.ai_runs (
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
create index ai_runs_workflow_idx on public.ai_runs (workflow, started_at desc);

create table public.ai_actions (
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
create index ai_actions_status_idx on public.ai_actions (owner_id, status, created_at desc);

-- Outbound communication must never be auto-executed.
alter table public.ai_actions
  add constraint ai_actions_outbound_requires_approval
  check (requires_approval or type not in ('email_draft','text_draft','stage_change'));

-- ---------------------------------------------------------- listing marketing
create table public.listing_marketing (
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
create index listing_marketing_listing_idx on public.listing_marketing (listing_id, kind);

-- Photography, floor plans, video files — pointers only, no binaries in Postgres.
create table public.marketing_assets (
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
create index marketing_assets_listing_idx on public.marketing_assets (listing_id, sort_order);

-- ------------------------------------------------------------- daily briefs
create table public.daily_briefs (
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

create table public.appointment_preps (
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
create table public.integration_connections (
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
create table public.audit_log (
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
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);

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
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end;
$$;
