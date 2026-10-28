-- Draft only: account-scoped Realtime authorization for Presence/Broadcast.
-- Realtime project setting "Allow public access" must also be disabled.
-- The topic identifies the KATOOS owner, NOT a trusted Mesh peer.
create policy "katosync_mesh_owner_realtime_read"
on realtime.messages
for select to authenticated
using (
  (select auth.uid()) is not null
  and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  and (select realtime.topic()) = 'katosync-mesh-owner:v1:' || (select auth.uid())::text
  and realtime.messages.extension in ('presence','broadcast')
);
create policy "katosync_mesh_owner_realtime_write"
on realtime.messages
for insert to authenticated
with check (
  (select auth.uid()) is not null
  and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  and (select realtime.topic()) = 'katosync-mesh-owner:v1:' || (select auth.uid())::text
  and realtime.messages.extension in ('presence','broadcast')
);
