-- NMKato Solutions / KatoSync Mesh: queued signed inbox delivery only.
-- Intentionally NOT deployed by this draft. No client-side writes or trust.
-- Edge service role may submit signed, target-bound offers after online issuer,
-- KatoSync membership, Ed25519 key and ownership verification.
alter table katosync.mesh_invites
 add column dispatch_signature text not null
 check (dispatch_signature ~ '^[A-Za-z0-9_-]{86}$');
grant insert on katosync.mesh_invites to service_role;

create function katosync.mesh_invite_send_guard()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  recent_count integer;
  pending_pair_count integer;
begin
  -- Serialize concurrent submissions under the same owner; prevent race bypass.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(new.owner_user_id::text)::bigint
  );
  if new.state <> 'pending' or new.resolved_at is not null
     or new.created_at < pg_catalog.now() - interval '10 seconds'
     or new.created_at > pg_catalog.now() + interval '10 seconds'
     or new.expires_at <= pg_catalog.now() then
    raise exception 'KATOSYNC_MESH_INVITE_INVALID'
      using errcode = '23514';
  end if;
  select count(*) into recent_count from katosync.mesh_invites
   where owner_user_id = new.owner_user_id
     and created_at >= pg_catalog.now() - interval '1 minute';
  if recent_count >= 3 then
    raise exception 'KATOSYNC_MESH_INVITE_RATE_LIMIT'
      using errcode = '23514';
  end if;
  select count(*) into pending_pair_count from katosync.mesh_invites
   where owner_user_id = new.owner_user_id
     and source_device_id = new.source_device_id
     and target_device_id = new.target_device_id
     and state = 'pending'
     and expires_at > pg_catalog.now();
  if pending_pair_count > 0 then
    raise exception 'KATOSYNC_MESH_INVITE_ALREADY_PENDING'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function katosync.mesh_invite_send_guard()
 from public, anon, authenticated;
grant execute on function katosync.mesh_invite_send_guard() to service_role;
create trigger katosync_mesh_invite_send_guard_before_insert
 before insert on katosync.mesh_invites for each row
 execute function katosync.mesh_invite_send_guard();

comment on function katosync.mesh_invite_send_guard() is
 'Account-scoped anti-spam/concurrency guard. Invite storage never grants peer trust or transport.';
