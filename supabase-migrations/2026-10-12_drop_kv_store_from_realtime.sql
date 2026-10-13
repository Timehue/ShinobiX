-- Take kv_store out of the supabase_realtime publication (2026-10-12). Idempotent.
--
-- Owner-approved. Apply only after the client that no longer subscribes to
-- Realtime is live (PR #358, shipped in #360 / 52ee74366, live 2026-10-13 01:02Z)
-- and open tabs have had time to refresh: an older tab still subscribes and,
-- with nothing published, would wait for its 10 s watchdog before falling back
-- to the battle stream.
--
-- Why: Realtime's Postgres Changes decodes EVERY kv_store write through wal2json
-- polling (realtime.list_changes), ~9.4% of database time, and wal2json ignores
-- the `key like 'pvp:%'` publication row filter. Nothing subscribes any more.
--
-- Rollback: alter publication supabase_realtime add table public.kv_store where (key like 'pvp:%');

do $$
begin
    if exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kv_store'
    ) then
        alter publication supabase_realtime drop table public.kv_store;
    end if;
end $$;
