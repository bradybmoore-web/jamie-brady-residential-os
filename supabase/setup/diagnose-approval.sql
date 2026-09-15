-- =============================================================================
-- Troubleshooting — why was an account not approved?
--
-- Run this in the Supabase SQL editor when a profile shows approved = false
-- although its address was put on the allowlist. It only reads, and it prints
-- no email addresses: every address is reduced to a length, a few flags and a
-- short fingerprint. Two rows with the same fingerprint hold the same address.
--
-- Nothing here is a secret and nothing here changes any data.
-- =============================================================================

-- 1. Every profile, with the reason an unapproved one did not match.
-- Diagnose why a profile was not approved. Reveals no addresses.
with prof as (
  select p.email as raw,
         lower(btrim(p.email)) as norm,
         lower(translate(p.email, E' \t\n\r ', '')) as squashed,
         p.approved
  from public.profiles p
),
al as (
  select a.email as raw,
         a.note,
         lower(translate(a.email, E' \t\n\r ', '')) as squashed
  from public.allowed_team_emails a
),
-- allowlist rows not already claimed by an approved profile
unclaimed as (
  select al.* from al
  where not exists (
    select 1 from prof where prof.approved and prof.squashed = al.squashed
  )
)
select
  case when p.approved then 'APPROVED' else 'NOT APPROVED' end as state,
  case
    when p.approved                              then 'OK - matches the allowlist exactly'
    when best.squashed = p.squashed              then 'CAUSE: STRAY WHITESPACE - identical once spaces are removed'
    when best.squashed is null                   then 'CAUSE: NO UNCLAIMED ALLOWLIST ROW to compare against'
    when split_part(best.squashed,'@',2) = split_part(p.squashed,'@',2)
                                                 then 'CAUSE: TEXT BEFORE THE @ DIFFERS - domain is the same'
    when split_part(best.squashed,'@',1) = split_part(p.squashed,'@',1)
                                                 then 'CAUSE: DOMAIN DIFFERS - text before the @ is the same'
    else                                              'CAUSE: BOTH HALVES DIFFER - wrong address on one side'
  end as diagnosis,
  length(p.raw)                        as char_len,
  p.raw <> btrim(p.raw)                as has_edge_space,
  position(chr(160) in p.raw) > 0      as has_nbsp,
  octet_length(p.raw) <> length(p.raw) as has_non_ascii,
  left(md5(p.squashed), 8)             as fingerprint
from prof p
left join lateral (
  select u.squashed from unclaimed u
  order by (split_part(u.squashed,'@',1) = split_part(p.squashed,'@',1))::int * 2
         + (split_part(u.squashed,'@',2) = split_part(p.squashed,'@',2))::int desc
  limit 1
) best on not p.approved
order by p.approved desc;

-- 2. The allowlist itself, to compare fingerprints against.
select note,
       length(email)                          as char_len,
       email <> btrim(email)                  as has_edge_space,
       position(chr(160) in email) > 0        as has_nbsp,
       octet_length(email) <> length(email)   as has_non_ascii,
       left(md5(lower(translate(email, E' \t\n\r ', ''))), 8) as fingerprint
from public.allowed_team_emails
order by note;
