-- Migration: revoke anon read on Chronicle duel records (P0)
-- Apply to the live Supabase project BEFORE / alongside the code deploy.
-- Run in the Supabase SQL editor (or `supabase db execute`). Idempotent.
--
-- Why: `cw-tilecards:<challengeId>` rows hold BOTH players' full 40-card decks,
-- both hands, and the face-down identity of every set monster and trap. The
-- authenticated handler (api/clan/war/tilecards.ts) only ever returns
-- `projectMatchForViewer()`, which redacts all of that per viewer — but the
-- kv_store anon SELECT policy allowed `key like 'cw-tilecards:%'`, so anyone
-- holding the public anon key could read the raw row straight from PostgREST and
-- see their opponent's hand and traps mid-duel.
--
-- The Chronicle duel screen never subscribed to this key via Realtime (it polls
-- the authenticated endpoint on a 3s timer), so removing the grant is a pure
-- removal with no client-visible behavior change.
--
-- Rollback (do NOT — this re-opens the leak):
--   re-add `or key like 'cw-tilecards:%'` to the policy USING clause below.

-- 1. Narrow the anon SELECT allowlist to pvp:* only.
drop policy if exists "kv_store_anon_select" on public.kv_store;

create policy "kv_store_anon_select"
    on public.kv_store
    for select
    to anon
    using (
        key like 'pvp:%'
    );

-- 2. Drop cw-tilecards:* from the Realtime publication filter as well, so the
--    walsender stops decoding those rows (nothing subscribed to them).
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        alter publication supabase_realtime set table public.kv_store
            where (key like 'pvp:%');
    end if;
end $$;

-- 3. Verify: this must return 0 rows when executed as the `anon` role.
--    select count(*) from public.kv_store where key like 'cw-tilecards:%';
