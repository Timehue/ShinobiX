-- Remove the browser (anon) read access to kv_store (2026-10-12). Idempotent.
--
-- Owner-approved cleanup after the Supabase Realtime removal. The policy
-- `kv_store_anon_select` (key like 'pvp:%') and the anon SELECT grant existed
-- only so the browser's Realtime subscription could pass RLS. Nothing
-- subscribes since #358, and kv_store left the supabase_realtime publication
-- (2026-10-12_drop_kv_store_from_realtime.sql, apply that first). Meanwhile
-- they let anyone holding the public anon key list and read every PvP session
-- row through the Data API. The game server reads only with the service role,
-- which bypasses RLS, so no game path used them.
--
-- RLS stays enabled; with no policy and no grant, anon sees and does nothing.
--
-- Rollback:
--   grant select on public.kv_store to anon;
--   create policy "kv_store_anon_select" on public.kv_store for select to anon using (key like 'pvp:%');

drop policy if exists "kv_store_anon_select" on public.kv_store;
revoke all on public.kv_store from anon;
