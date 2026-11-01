-- NMKato Solutions — Stage 3K disposable local PostgreSQL setup only.
-- No production database, no TCP listener, no online auth.
\set ON_ERROR_STOP on
\ir mesh_inbox_edge_e2e_setup.sql
\ir ../../supabase/migrations/20261031213900_mesh_pairing_relay_staged.sql
DO $$
BEGIN
 IF has_table_privilege('authenticated','katosync.mesh_pairing_relay_messages','SELECT')
 OR has_table_privilege('authenticated','katosync.mesh_pairing_relay_messages','INSERT')
 OR has_table_privilege('authenticated','katosync.mesh_pairing_relay_reads','INSERT')
 OR NOT has_table_privilege('service_role','katosync.mesh_pairing_relay_messages','INSERT')
 THEN RAISE EXCEPTION 'STAGE3K_RELAY_GRANTS_INVALID'; END IF;
END $$;
\echo STAGE3K_EPHEMERAL_SQL_SCHEMA_READY
