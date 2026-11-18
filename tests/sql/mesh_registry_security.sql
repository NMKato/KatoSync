\set ON_ERROR_STOP on
-- Run only in a throwaway local PostgreSQL test cluster, never in production.
create role authenticated nologin;
create role anon nologin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

-- The harness will execute the generated migration *before* these fixtures.
