-- Stage 3W: data-state digest for disposable PostgreSQL restore test only.
-- Script is run for source and restored DB through psql -A -t.
SELECT md5(string_agg(tbl || ':' || coalesce(serialized,'<empty>'),'#' ORDER BY tbl))
FROM (
 SELECT 'account_memberships' AS tbl,string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text) AS serialized FROM katosync.account_memberships x
 UNION ALL SELECT 'mesh_devices',string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text) FROM katosync.mesh_devices x
 UNION ALL SELECT 'mesh_enrollment_challenges',string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text) FROM katosync.mesh_enrollment_challenges x
 UNION ALL SELECT 'mesh_invites',string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text) FROM katosync.mesh_invites x
 UNION ALL SELECT 'mesh_owner_policy',string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text) FROM katosync.mesh_owner_policy x
 UNION ALL SELECT 'mesh_inbox_proofs',string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text) FROM katosync.mesh_inbox_proofs x
 UNION ALL SELECT 'mesh_pairing_relay_messages',string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text) FROM katosync.mesh_pairing_relay_messages x
 UNION ALL SELECT 'mesh_pairing_relay_reads',string_agg(to_jsonb(x)::text,'|' ORDER BY to_jsonb(x)::text) FROM katosync.mesh_pairing_relay_reads x
) x;
