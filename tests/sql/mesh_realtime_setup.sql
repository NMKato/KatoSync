\set ON_ERROR_STOP on
create role authenticated nologin;
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as
 $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as
 $$select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb$$;
create schema realtime;
create table realtime.messages(
  id bigint generated always as identity primary key,
  extension text not null,
  payload jsonb not null default '{}'::jsonb
);
create function realtime.topic() returns text language sql stable as
 $$select current_setting('request.realtime.topic', true)$$;
alter table realtime.messages enable row level security;
grant usage on schema realtime, auth to authenticated, anon;
grant select,insert on realtime.messages to authenticated;
grant usage,select on sequence realtime.messages_id_seq to authenticated;
grant execute on function auth.uid(),auth.jwt(),realtime.topic() to authenticated,anon;
