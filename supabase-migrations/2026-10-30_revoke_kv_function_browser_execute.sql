-- Remove browser EXECUTE from the last three kv_* functions (2026-10-30). Idempotent.
--
-- Owner-approved after the 2026-10-30 Supabase audit. kv_incr, kv_set_nx and
-- kv_delete_expired still carried EXECUTE for PUBLIC, anon and authenticated:
-- the revoke block at the end of supabase-schema.sql never reached production
-- for them. Every call failed only because those roles have no kv_store
-- privilege, so one SECURITY DEFINER change would have opened the table to
-- anyone holding the public key.
--
-- shinobix_app and service_role keep their own explicit grants, and the
-- kv-cleanup cron job runs as the owner (postgres), so nothing the game does
-- changes.
--
-- Rollback:
--   grant execute on function public.kv_set_nx(text, jsonb, timestamptz) to public, anon, authenticated;
--   grant execute on function public.kv_incr(text, timestamptz) to public, anon, authenticated;
--   grant execute on function public.kv_delete_expired() to public, anon, authenticated;

revoke all on function public.kv_set_nx(text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.kv_incr(text, timestamptz) from public, anon, authenticated;
revoke all on function public.kv_delete_expired() from public, anon, authenticated;
