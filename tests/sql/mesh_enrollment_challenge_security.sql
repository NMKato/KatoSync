\set ON_ERROR_STOP on
-- PostgreSQL isolated local harness: service_role may create public challenges;
-- anon and authenticated may not inspect, insert, consume or delete them.
select case when (select relrowsecurity from pg_class
  where oid='public.katosync_mesh_enrollment_challenges'::regclass)
  then 'RLS_ENABLED' else 'MISSING_RLS' end;
set role service_role;
insert into public.katosync_mesh_enrollment_challenges
  (owner_user_id,signing_public_key,nonce,expires_at)
values ('11111111-1111-4111-8111-111111111111',repeat('A',43),repeat('B',43),now()+interval '90 seconds');
reset role;
set role authenticated;
do $check$
begin
 begin
  perform count(*) from public.katosync_mesh_enrollment_challenges;
  raise exception 'Authenticated client could read enrollment challenges';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into public.katosync_mesh_enrollment_challenges
   (owner_user_id,signing_public_key,nonce,expires_at)
   values ('11111111-1111-4111-8111-111111111111',repeat('C',43),repeat('D',43),now()+interval '60 seconds');
  raise exception 'Authenticated client could forge enrollment nonce';
 exception when insufficient_privilege then null;
 end;
end $check$;
reset role;
set role anon;
do $check$
begin
 begin
  perform count(*) from public.katosync_mesh_enrollment_challenges;
  raise exception 'Anonymous read challenge table';
 exception when insufficient_privilege then null;
 end;
end $check$;
reset role;
do $check$
begin
 begin
  insert into public.katosync_mesh_enrollment_challenges
   (owner_user_id,signing_public_key,nonce,expires_at)
   values ('11111111-1111-4111-8111-111111111111',repeat('C',43),repeat('E',43),now()+interval '4 minutes');
  raise exception 'Overlong challenge accepted';
 exception when check_violation then null;
 end;
end $check$;
select 'MESH_ENROLLMENT_CHALLENGE_RLS_PASS' as result;

-- Server-side quota cannot be raced with a third device: a trigger enforces it.
set role service_role;
do $test$
begin
 begin
  insert into public.katosync_mesh_devices
   (owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
   values ('11111111-1111-4111-8111-111111111111',repeat('X',43),
           repeat('EF-',15)||'EF','Third','macos');
  raise exception 'Quota allowed third device';
 exception when check_violation then null;
 end;
 begin
  insert into public.katosync_mesh_devices
   (owner_user_id,signing_public_key,fingerprint,display_name,platform_os)
   values ('22222222-2222-4222-8222-222222222222',repeat('A',43),
           repeat('AC-',15)||'AC','Stolen key','linux');
  raise exception 'Cross-owner public key was not globally unique';
 exception when unique_violation then null;
 end;
end $test$;
reset role;
select 'MESH_DEVICE_QUOTA_AND_UNIQUE_KEY_PASS' as result;
set role service_role;
-- Existing fixture challenge is first owner request; two additional allowed.
insert into public.katosync_mesh_enrollment_challenges(owner_user_id,signing_public_key,nonce,expires_at)
 values ('11111111-1111-4111-8111-111111111111',repeat('D',43),repeat('R',43),now()+interval '80 seconds'),
        ('11111111-1111-4111-8111-111111111111',repeat('E',43),repeat('S',43),now()+interval '80 seconds');
do $test$
begin
 begin
  insert into public.katosync_mesh_enrollment_challenges(owner_user_id,signing_public_key,nonce,expires_at)
   values ('11111111-1111-4111-8111-111111111111',repeat('F',43),repeat('T',43),now()+interval '80 seconds');
  raise exception 'Fourth challenge unexpectedly allowed';
 exception when check_violation then null;
 end;
end $test$;
reset role;
select 'MESH_CHALLENGE_DB_RATE_LIMIT_PASS' as result;
