\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set request.jwt.claims = '{"is_anonymous":false}';
set request.realtime.topic = 'katosync-mesh-owner:v1:11111111-1111-4111-8111-111111111111';
insert into realtime.messages(extension) values ('presence'),('broadcast');
do $$
begin
 if (select count(*) from realtime.messages) <> 2 then
  raise exception 'own account channel denied';
 end if;
end $$;
set request.realtime.topic = 'katosync-mesh-owner:v1:22222222-2222-4222-8222-222222222222';
do $$
begin
 if (select count(*) from realtime.messages) <> 0 then
  raise exception 'other account channel allowed';
 end if;
 begin
  insert into realtime.messages(extension) values ('presence');
  raise exception 'other account broadcast allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
set request.realtime.topic = 'katosync-mesh-owner:v1:11111111-1111-4111-8111-111111111111-extra';
do $$
begin
 if (select count(*) from realtime.messages) <> 0 then
  raise exception 'prefix matching accepted';
 end if;
end $$;
set request.realtime.topic = 'katosync-mesh-owner:v1:11111111-1111-4111-8111-111111111111';
do $$
begin
 begin
  insert into realtime.messages(extension) values ('postgres_changes');
  raise exception 'unapproved message type accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
set request.jwt.claims = '{"is_anonymous":true}';
do $$
begin
 if (select count(*) from realtime.messages) <> 0 then
  raise exception 'anonymous signed-in user can read';
 end if;
 begin
  insert into realtime.messages(extension) values ('presence');
  raise exception 'anonymous signed-in user can send';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
set role anon;
do $$
begin
 begin
  perform count(*) from realtime.messages;
  raise exception 'anon read allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
select 'MESH_REALTIME_PRIVATE_RLS_PASS' as result;
