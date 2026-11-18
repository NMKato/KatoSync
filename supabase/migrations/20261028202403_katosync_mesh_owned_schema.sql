-- NMKato Solutions: KatoSync-owned namespace; no KATOOS tables touched.
-- Shared Supabase project + shared auth.users; independently permissioned.
CREATE SCHEMA IF NOT EXISTS katosync;
REVOKE ALL ON SCHEMA katosync FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA katosync TO authenticated, service_role;

-- NMKato Solutions / KatoSync Mesh account-scoped discovery registry.
-- Fail-closed Stage 0: authenticated clients can READ only their own public
-- mesh metadata. No direct client INSERT/UPDATE/DELETE until a separate
-- cryptographic, session-verified Edge enrollment and inbox service exists.
-- This migration does NOT enable peer trust, mTLS, or remote execution.

create table katosync.mesh_devices (
  device_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  signing_public_key text not null
    check (signing_public_key ~ '^[A-Za-z0-9_-]{43}$'),
  fingerprint text not null
    check (fingerprint ~ '^([0-9A-F]{2}-){15}[0-9A-F]{2}$'),
  display_name text not null
    check (char_length(display_name) between 1 and 80),
  persona_name text
    check (persona_name is null or char_length(persona_name) between 1 and 80),
  platform_os text not null
    check (platform_os in ('macos','windows','linux')),
  membership_state text not null default 'discovered'
    check (membership_state in ('discovered','pending','trusted','revoked')),
  last_seen_at timestamptz,
  enrolled_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mesh_device_owner_key_unique unique (owner_user_id, signing_public_key),
  constraint mesh_device_owner_id_unique unique (owner_user_id, device_id),
  constraint mesh_device_revoke_consistency check (
    (membership_state = 'revoked') = (revoked_at is not null)
  )
);
create index katosync_mesh_devices_owner_visible_idx
  on katosync.mesh_devices(owner_user_id, membership_state, last_seen_at desc);

create table katosync.mesh_owner_policy (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  enrollment_mode text not null default 'manual'
    check (enrollment_mode in ('manual','auto')),
  owner_opt_in_verified boolean not null default false,
  passkey_enrollment_required boolean not null default true
    check (passkey_enrollment_required = true),
  allowed_devices integer not null default 2
    check (allowed_devices between 1 and 10),
  policy_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Never claim auto-enrollment from a stale or unsigned flag.
  constraint mesh_owner_policy_auto_requires_opt_in check (
    enrollment_mode <> 'auto' or
    (owner_opt_in_verified = true and policy_expires_at is not null)
  )
);

create table katosync.mesh_invites (
  request_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_device_id uuid not null,
  target_device_id uuid not null,
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{43}$'),
  -- This is public signed material only. No access/refresh tokens or device seeds.
  signed_offer jsonb not null,
  state text not null default 'pending'
    check (state in ('pending','accepted','rejected','expired','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  constraint mesh_invite_source_owner_fk foreign key (owner_user_id, source_device_id)
    references katosync.mesh_devices(owner_user_id, device_id),
  constraint mesh_invite_target_owner_fk foreign key (owner_user_id, target_device_id)
    references katosync.mesh_devices(owner_user_id, device_id),
  constraint mesh_invite_two_distinct_devices check (source_device_id <> target_device_id),
  constraint mesh_invite_lifetime check (
    expires_at > created_at and expires_at <= created_at + interval '5 minutes'
  ),
  constraint mesh_invite_nonce_unique unique (owner_user_id, source_device_id, nonce),
  constraint mesh_invite_payload_size check (
    jsonb_typeof(signed_offer) = 'object'
    and octet_length(signed_offer::text) between 2 and 8192
  ),
  constraint mesh_invite_resolution_consistency check (
    (state = 'pending' and resolved_at is null)
    or (state <> 'pending' and resolved_at is not null)
  )
);
create index katosync_mesh_invites_inbox_idx
  on katosync.mesh_invites(owner_user_id, target_device_id, created_at desc);

-- All 3 tables are queryable only by the owner, even when seen via PostgREST.
alter table katosync.mesh_devices enable row level security;
alter table katosync.mesh_owner_policy enable row level security;
alter table katosync.mesh_invites enable row level security;

-- Supabase default privileges may grant full DML. Explicitly revoke them.
revoke all on katosync.mesh_devices from public, anon, authenticated;
revoke all on katosync.mesh_owner_policy from public, anon, authenticated;
revoke all on katosync.mesh_invites from public, anon, authenticated;
grant select on katosync.mesh_devices to authenticated;
grant select on katosync.mesh_owner_policy to authenticated;
grant select on katosync.mesh_invites to authenticated;

create policy "mesh_devices_owner_read"
  on katosync.mesh_devices for select to authenticated
  using (owner_user_id = (select auth.uid()));
create policy "mesh_policy_owner_read"
  on katosync.mesh_owner_policy for select to authenticated
  using (owner_user_id = (select auth.uid()));
create policy "mesh_invites_owner_read"
  on katosync.mesh_invites for select to authenticated
  using (owner_user_id = (select auth.uid()));

comment on table katosync.mesh_devices is
 'Owner-only public device roster; entries are NOT trusted unless independent native and server cryptographic checks succeed.';
comment on table katosync.mesh_owner_policy is
 'Owner-only auto-enrollment preference; UI value must never grant trust; server enrollment requires device-bound passkey proof.';
comment on table katosync.mesh_invites is
 'Owner-only pending signed invitations, NOT authorization. Service must verify issuer session, signatures, one-time nonce and expiry.';

-- KatoSync Mesh: server-only short-lived Ed25519 enrollment challenges.
-- Staged migration. No client write access, no implicit pairing.
create table katosync.mesh_enrollment_challenges (
  challenge_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  signing_public_key text not null
    check (signing_public_key ~ '^[A-Za-z0-9_-]{43}$'),
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint katosync_mesh_challenge_lifetime check (
    expires_at > created_at and expires_at <= created_at + interval '2 minutes'
  ),
  constraint katosync_mesh_challenge_consumed_after_creation check (
    consumed_at is null or consumed_at >= created_at
  ),
  constraint katosync_mesh_challenge_nonce_unique unique (owner_user_id, nonce)
);
create index katosync_mesh_challenge_owner_recent_idx
  on katosync.mesh_enrollment_challenges(owner_user_id, created_at desc);
alter table katosync.mesh_enrollment_challenges enable row level security;
revoke all on katosync.mesh_enrollment_challenges from public, anon, authenticated;
-- Edge service-role may create/consume a challenge only after online issuer verification.
grant select, insert, update, delete on katosync.mesh_enrollment_challenges to service_role;
comment on table katosync.mesh_enrollment_challenges is
 'Temporary server-owned nonce for Ed25519 device possession proof. Not an enrollment, trust or remote access grant.';

-- Separate device identity across accounts; same public key must not be claimed
-- by two owners. Only the service-role enrollment verifier may insert discovery.
create unique index katosync_mesh_global_signing_public_key_unique
 on katosync.mesh_devices(signing_public_key);
grant select, insert on katosync.mesh_devices to service_role;
grant select on katosync.mesh_owner_policy to service_role;
grant select on katosync.mesh_invites to service_role;

-- Race-safe account quota. Concurrent discovery proofs for the same owner
-- share a transaction lock before the count is checked.
create function katosync.mesh_device_quota_guard()
 returns trigger language plpgsql security invoker set search_path = ''
as $$
declare n integer;
declare allowed integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.owner_user_id::text)::bigint);
 select allowed_devices into allowed from katosync.mesh_owner_policy
   where owner_user_id=new.owner_user_id;
 select count(*) into n from katosync.mesh_devices
   where owner_user_id=new.owner_user_id;
 if n >= coalesce(allowed,2) then
  raise exception 'KATOSYNC_MESH_DEVICE_QUOTA' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function katosync.mesh_device_quota_guard() from public, anon, authenticated;
grant execute on function katosync.mesh_device_quota_guard() to service_role;
create trigger katosync_mesh_device_quota_before_insert
 before insert on katosync.mesh_devices
 for each row execute function katosync.mesh_device_quota_guard();

-- Authoritative concurrent challenge budget: the Edge pre-check is only an
-- early rejection; the DB trigger serializes simultaneous requests per owner.
create function katosync.mesh_challenge_rate_guard()
 returns trigger language plpgsql security invoker set search_path = ''
as $$
declare issued integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.owner_user_id::text)::bigint);
 select count(*) into issued
 from katosync.mesh_enrollment_challenges
 where owner_user_id = new.owner_user_id
   and created_at >= pg_catalog.now() - interval '1 minute';
 if issued >= 3 then
  raise exception 'KATOSYNC_MESH_CHALLENGE_RATE_LIMIT' using errcode = '23514';
 end if;
 return new;
end;
$$;
revoke all on function katosync.mesh_challenge_rate_guard() from public, anon, authenticated;
grant execute on function katosync.mesh_challenge_rate_guard() to service_role;
create trigger katosync_mesh_challenge_rate_before_insert
 before insert on katosync.mesh_enrollment_challenges
 for each row execute function katosync.mesh_challenge_rate_guard();


-- Explicit service-only write grants. Authenticated user access stays
-- read-only and owner-isolated via the row policies above.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA katosync TO service_role;
GRANT SELECT ON katosync.mesh_devices, katosync.mesh_owner_policy,
 katosync.mesh_invites TO authenticated;
-- Do not grant schema usage or SELECT to anon.
