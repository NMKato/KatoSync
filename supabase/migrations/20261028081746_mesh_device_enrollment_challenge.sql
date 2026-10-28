-- KatoSync Mesh: server-only short-lived Ed25519 enrollment challenges.
-- Staged migration. No client write access, no implicit pairing.
create table public.katosync_mesh_enrollment_challenges (
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
  on public.katosync_mesh_enrollment_challenges(owner_user_id, created_at desc);
alter table public.katosync_mesh_enrollment_challenges enable row level security;
revoke all on public.katosync_mesh_enrollment_challenges from public, anon, authenticated;
-- Edge service-role may create/consume a challenge only after online issuer verification.
grant select, insert, update, delete on public.katosync_mesh_enrollment_challenges to service_role;
comment on table public.katosync_mesh_enrollment_challenges is
 'Temporary server-owned nonce for Ed25519 device possession proof. Not an enrollment, trust or remote access grant.';

-- Separate device identity across accounts; same public key must not be claimed
-- by two owners. Only the service-role enrollment verifier may insert discovery.
create unique index katosync_mesh_global_signing_public_key_unique
 on public.katosync_mesh_devices(signing_public_key);
grant select, insert on public.katosync_mesh_devices to service_role;
grant select on public.katosync_mesh_owner_policy to service_role;
grant select on public.katosync_mesh_invites to service_role;

-- Race-safe account quota. Concurrent discovery proofs for the same owner
-- share a transaction lock before the count is checked.
create function public.katosync_mesh_device_quota_guard()
 returns trigger language plpgsql security invoker set search_path = ''
as $$
declare n integer;
declare allowed integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.owner_user_id::text)::bigint);
 select allowed_devices into allowed from public.katosync_mesh_owner_policy
   where owner_user_id=new.owner_user_id;
 select count(*) into n from public.katosync_mesh_devices
   where owner_user_id=new.owner_user_id;
 if n >= coalesce(allowed,2) then
  raise exception 'KATOSYNC_MESH_DEVICE_QUOTA' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function public.katosync_mesh_device_quota_guard() from public, anon, authenticated;
grant execute on function public.katosync_mesh_device_quota_guard() to service_role;
create trigger katosync_mesh_device_quota_before_insert
 before insert on public.katosync_mesh_devices
 for each row execute function public.katosync_mesh_device_quota_guard();
