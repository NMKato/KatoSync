-- KatoSync schema exposure, only append to verified existing API schemas.
-- Exact role configuration was independently checked before live apply.
-- Keep the legacy KATOOS API schemas untouched.
DO $$
DECLARE existing text[];
BEGIN
  SELECT rolconfig INTO existing FROM pg_roles WHERE rolname='authenticator';
  IF existing IS NULL OR NOT ('pgrst.db_schemas=public, graphql_public, katoos_cms, agent_profile' = ANY(existing)) THEN
    RAISE EXCEPTION 'KATOSYNC_API_PRECHECK_FAILED';
  END IF;
END $$;
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, katoos_cms, agent_profile, katosync';
NOTIFY pgrst, 'reload config';
