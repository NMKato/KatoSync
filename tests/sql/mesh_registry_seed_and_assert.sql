\set ON_ERROR_STOP on
-- Fixture users are purely synthetic. No real account data is read.
insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');

insert into public.katosync_mesh_devices
(device_id,owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111',
 repeat('A',43),repeat('AA-',15)||'AA','M2','macos'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','11111111-1111-4111-8111-111111111111',
 repeat('B',43),repeat('BB-',15)||'BB','M3','macos'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','22222222-2222-4222-8222-222222222222',
 repeat('C',43),repeat('CC-',15)||'CC','Other','windows');

insert into public.katosync_mesh_owner_policy(owner_user_id)
values ('11111111-1111-4111-8111-111111111111'),
       ('22222222-2222-4222-8222-222222222222');

insert into public.katosync_mesh_invites
(owner_user_id,source_device_id,target_device_id,nonce,signed_offer,expires_at)
values
('11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
 repeat('N',43),'{"protocol":"katosync-mesh-pairing-v1","public_only":true}'::jsonb,
 now()+ interval '4 minutes');

do $test$
begin
  if (select count(*) from pg_policies where schemaname='public' and tablename like 'katosync_mesh_%') <> 3 then
    raise exception 'Expected 3 owner-scoped RLS policies';
  end if;
  if (select count(*) from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
       where ns.nspname='public' and c.relname like 'katosync_mesh_%'
       and c.relrowsecurity) <> 3 then
    raise exception 'Expected RLS enabled for 3 tables';
  end if;
  if has_table_privilege('authenticated','public.katosync_mesh_devices','INSERT') or
     has_table_privilege('authenticated','public.katosync_mesh_devices','UPDATE') or
     has_table_privilege('authenticated','public.katosync_mesh_devices','DELETE') or
     has_table_privilege('authenticated','public.katosync_mesh_owner_policy','UPDATE') or
     has_table_privilege('authenticated','public.katosync_mesh_invites','INSERT') or
     has_table_privilege('anon','public.katosync_mesh_devices','SELECT')
  then raise exception 'Unsafe client privileges';
  end if;
end $test$;

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $test$
begin
  if (select count(*) from public.katosync_mesh_devices)<>2 then
    raise exception 'RLS leaked devices or owner devices absent';
  end if;
  if (select count(*) from public.katosync_mesh_owner_policy)<>1 then
    raise exception 'RLS leaked auto policy';
  end if;
  if (select count(*) from public.katosync_mesh_invites)<>1 then
    raise exception 'RLS leaked pending invite';
  end if;
  begin
    insert into public.katosync_mesh_devices(owner_user_id,signing_public_key,
    fingerprint,display_name,platform_os) values
    ('11111111-1111-4111-8111-111111111111',repeat('D',43),
    repeat('DD-',15)||'DD','Injected','macos');
    raise exception 'Client was incorrectly allowed to register a device';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.katosync_mesh_devices set membership_state='trusted';
    raise exception 'Client was incorrectly allowed to approve peers';
  exception when insufficient_privilege then null;
  end;
end $test$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $test$
begin
  if (select count(*) from public.katosync_mesh_devices)<>1 then
    raise exception 'Cross-account device visibility';
  end if;
  if (select count(*) from public.katosync_mesh_owner_policy)<>1 then
    raise exception 'Cross-account policy visibility';
  end if;
  if (select count(*) from public.katosync_mesh_invites)<>0 then
    raise exception 'Cross-account invitation visibility';
  end if;
end $test$;
reset role;
set role anon;
do $test$
begin
  begin
    perform count(*) from public.katosync_mesh_devices;
    raise exception 'Anonymous actor read devices';
  exception when insufficient_privilege then null;
  end;
end $test$;
reset role;

-- Foreign-key bound to same owner on both devices. No cross-account invitations.
do $test$
begin
  begin
    insert into public.katosync_mesh_invites
      (owner_user_id,source_device_id,target_device_id,nonce,signed_offer,expires_at)
    values
      ('11111111-1111-4111-8111-111111111111',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
       repeat('Z',43),'{"public_only":true}'::jsonb,now()+interval '4 minutes');
    raise exception 'Cross-account invite inserted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.katosync_mesh_invites
      (owner_user_id,source_device_id,target_device_id,nonce,signed_offer,expires_at)
    values
      ('11111111-1111-4111-8111-111111111111',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
       repeat('Y',43),'{"public_only":true}'::jsonb,now()+interval '9 minutes');
    raise exception 'Overlong invite inserted';
  exception when check_violation then null;
  end;
  begin
    insert into public.katosync_mesh_owner_policy
      (owner_user_id,enrollment_mode,owner_opt_in_verified)
    values
      ('33333333-3333-4333-8333-333333333333','auto',false);
    raise exception 'Invalid opt-in accepted';
  exception when check_violation or foreign_key_violation then null;
  end;
end $test$;
select 'MESH_RLS_LOCAL_TESTS_PASS' as result;
