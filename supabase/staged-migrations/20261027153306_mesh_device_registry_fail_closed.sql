-- NMKato Solutions / KatoSync Mesh account-scoped discovery registry.
-- Fail-closed Stage 0: authenticated clients can READ only their own public
-- mesh metadata. No direct client INSERT/UPDATE/DELETE until a separate
-- cryptographic, session-verified Edge enrollment and inbox service exists.
-- This migration does NOT enable peer trust, mTLS, or remote execution.

create table public.katosync_mesh_devices (
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
  on public.katosync_mesh_devices(owner_user_id, membership_state, last_seen_at desc);

create table public.katosync_mesh_owner_policy (
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

create table public.katosync_mesh_invites (
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
    references public.katosync_mesh_devices(owner_user_id, device_id),
  constraint mesh_invite_target_owner_fk foreign key (owner_user_id, target_device_id)
    references public.katosync_mesh_devices(owner_user_id, device_id),
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
  on public.katosync_mesh_invites(owner_user_id, target_device_id, created_at desc);

-- All 3 tables are queryable only by the owner, even when seen via PostgREST.
alter table public.katosync_mesh_devices enable row level security;
alter table public.katosync_mesh_owner_policy enable row level security;
alter table public.katosync_mesh_invites enable row level security;

-- Supabase default privileges may grant full DML. Explicitly revoke them.
revoke all on public.katosync_mesh_devices from public, anon, authenticated;
revoke all on public.katosync_mesh_owner_policy from public, anon, authenticated;
revoke all on public.katosync_mesh_invites from public, anon, authenticated;
grant select on public.katosync_mesh_devices to authenticated;
grant select on public.katosync_mesh_owner_policy to authenticated;
grant select on public.katosync_mesh_invites to authenticated;

create policy "mesh_devices_owner_read"
  on public.katosync_mesh_devices for select to authenticated
  using (owner_user_id = (select auth.uid()));
create policy "mesh_policy_owner_read"
  on public.katosync_mesh_owner_policy for select to authenticated
  using (owner_user_id = (select auth.uid()));
create policy "mesh_invites_owner_read"
  on public.katosync_mesh_invites for select to authenticated
  using (owner_user_id = (select auth.uid()));

comment on table public.katosync_mesh_devices is
 'Owner-only public device roster; entries are NOT trusted unless independent native and server cryptographic checks succeed.';
comment on table public.katosync_mesh_owner_policy is
 'Owner-only auto-enrollment preference; UI value must never grant trust; server enrollment requires device-bound passkey proof.';
comment on table public.katosync_mesh_invites is
 'Owner-only pending signed invitations, NOT authorization. Service must verify issuer session, signatures, one-time nonce and expiry.';
