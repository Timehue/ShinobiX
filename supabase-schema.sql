-- ============================================================
-- ShinobiX — Supabase KV store schema
-- Run this in the Supabase SQL editor (idempotent — safe to re-run).
--
-- Access model:
--   * The server connects through DATABASE_URL as the login role shinobix_app
--     (Railway, through the Supavisor pooler). That role is limited to kv_store
--     and the kv_* functions, and does not bypass RLS; see its section below.
--   * SUPABASE_SERVICE_ROLE_KEY is only for the REST fallback in api/_storage.ts,
--     used when no Postgres URL is set. It BYPASSES RLS, so it must never reach
--     the client. Production does not use this path: kv_compare_set and
--     kv_guarded_operation (supabase-lock-fencing.sql) are not installed there,
--     and the fallback needs both.
--   * The browser does not talk to Supabase at all (since 2026-10-13: the
--     Realtime client was removed; PvP uses the server's /api/pvp/stream).
--     The anon role has NO policy and NO privilege on kv_store, so anyone
--     holding the public key sees nothing. RLS stays enabled.
-- ============================================================
--
-- Security posture — audit item #27 (verified-and-documented; no change needed)
-- ------------------------------------------------------------
-- "Per-player RLS so a logged-in user can only SELECT their own save:<name>"
-- does NOT apply to this app and is intentionally NOT implemented:
--   * Players do NOT authenticate via Supabase Auth — the game uses its own
--     password / session-token auth (see api/_auth.ts). The browser is always
--     the `anon` role; there is no Supabase `authenticated` user and no
--     auth.uid() to scope a per-row "owner" policy on.
--   * Every row is ALREADY server-only: anon and `authenticated` have no policy
--     AND no grant on kv_store, so both are refused before RLS is even reached.
--   * RLS is row-level and cannot project inside the `value` jsonb, so a record
--     that needs per-viewer redaction (Chronicle duels — hands, decks, face-down
--     cards) goes through the authenticated handler's projection, never a
--     direct read. See the PvP/guard projection helpers.
-- Defense-in-depth (APPLIED 2026-06-01, migration
-- `harden_kv_store_revoke_authenticated_select`): the `authenticated` role is
--   now granted NOTHING on kv_store (see the `revoke all … from authenticated`
--   below, with no re-grant). It previously carried a harmless-but-latent
--   `grant select` that would have exposed all rows if RLS were ever disabled;
--   the app never uses that role, so the grant was revoked. The `anon` grant
--   and policy followed on 2026-10-12, once nothing used Realtime.
-- ============================================================

-- ── Core table ───────────────────────────────────────────────────────────────

create table if not exists public.kv_store (
    key         text        primary key,
    value       jsonb       not null,
    expires_at  timestamptz null,
    updated_at  timestamptz not null default now()
);

-- Efficient expiry cleanup and pattern-matched key scans.
create index if not exists kv_store_expires_at_idx
    on public.kv_store (expires_at)
    where expires_at is not null;

create index if not exists kv_store_key_pattern_idx
    on public.kv_store (key text_pattern_ops);

-- ── Row-level security ───────────────────────────────────────────────────────
-- RLS MUST be ENABLED. shinobix_app passes through its own policy below and
-- service_role bypasses RLS; the anon role is what a browser holding the public
-- key would use.
--
-- Anon allowlist: NONE (since 2026-10-12, see below).
--
-- `cw-tilecards:*` was REMOVED from the anon allowlist (2026-07-23 hardening,
-- P0). The Chronicle duel record stores BOTH players' full decks, both hands,
-- and the face-down identity of every set monster/trap. api/clan/war/tilecards.ts
-- only ever returns `projectMatchForViewer()` (shared/chronicle-duel.ts), which
-- redacts all of that per viewer — but the anon SELECT grant let anyone holding
-- the public anon key read the RAW row and see their opponent's hand and traps.
-- ClanWarTileCardDuel never subscribed to the key via Realtime (it polls the
-- authenticated endpoint on a 3s timer), so removing the grant costs nothing.
-- Do NOT re-add it: if the duel ever needs push updates, publish a separate
-- key holding ONLY a revision counter and refetch the projection over HTTP.
--
-- `challenges:*` was REMOVED from the anon allowlist (2026-07-17 hardening). The
-- browser never subscribed to it via Realtime — incoming challenges are carried
-- by the AUTHENTICATED HTTP heartbeat plus a Socket.IO nudge
-- (api/player/challenge.ts kickPlayer), so the anon grant only let anyone holding
-- the public anon key enumerate every player's (projected) challenge inbox.
-- Delivery is unaffected by the removal. Do NOT re-add it — deliver any new
-- per-player inbox over the authenticated channel instead.
--
-- `pvp:*` was REMOVED too (2026-10-12): the anon allowlist is now EMPTY. It
-- existed only so the browser's Supabase Realtime subscription could pass RLS,
-- and since #358 the browser subscribes to nothing over Realtime
-- (lib/realtime.ts was deleted; PvP uses /api/pvp/stream) and kv_store left the
-- `supabase_realtime` publication (section below). Meanwhile the grant let
-- anyone holding the public anon key list and read every PvP session row
-- through the Data API. The server never read through anon, so nothing the game
-- does used it. Do NOT re-add an anon policy: serve browser reads through an
-- authenticated API route.

alter table public.kv_store enable row level security;

-- Drop the old anon policies. With RLS on and no policy, anon sees no rows.
drop policy if exists "anon_read_pvp_realtime" on public.kv_store;
drop policy if exists "kv_store_anon_select"   on public.kv_store;

-- The browser roles get no table privileges at all. RLS would already deny
-- every row; revoking the grants as well means even an accidental RLS disable
-- exposes nothing.
revoke all      on public.kv_store from anon;
-- audit #27 hardening (applied to prod 2026-06-01): the app never uses the
-- `authenticated` role (the server is `service_role`), so grant it NOTHING. RLS already denied it every row by
-- deny-by-default; revoking the grant also closes the "if RLS is ever disabled,
-- authenticated would see all rows" footgun. Do NOT re-add a grant here.
revoke all      on public.kv_store from authenticated;

-- ── Server login role: shinobix_app ──────────────────────────────────────────
-- The game's DATABASE_URL logs in as this role (2026-10-26, after the Railway
-- secret rotation). It gets the table and the kv_* functions and nothing else:
-- no TRUNCATE, no schema CREATE, no RLS bypass. A database built from this file
-- has no password on the role, so it cannot log in until you run this in the SQL
-- Editor (never commit the password):
--   alter role shinobix_app with password '...';
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'shinobix_app') then
        create role shinobix_app login;
    end if;
end $$;

grant usage on schema public to shinobix_app;
grant select, insert, update, delete on public.kv_store to shinobix_app;

-- Create only when missing. Do NOT drop and recreate it: that takes an exclusive
-- lock on kv_store, and between the two statements the game is refused every row.
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'kv_store' and policyname = 'shinobix_app_all'
    ) then
        create policy "shinobix_app_all"
            on public.kv_store
            for all
            to shinobix_app
            using (true)
            with check (true);
    end if;
end $$;

-- ── Realtime publication: kv_store is NOT published (2026-10-12) ─────────────
-- Nothing in the browser subscribes to Supabase Realtime any more: the PvP
-- battle screen's one live transport is the server's /api/pvp/stream, and
-- lib/realtime.ts was deleted. Keeping kv_store in `supabase_realtime` cost
-- ~9.4% of database time for nothing: Realtime's Postgres Changes reads the WAL
-- through wal2json polling (realtime.list_changes) and decodes EVERY kv_store
-- write, every save, rate-limit counter and presence beat, before discarding it.
-- The `where (key like 'pvp:%')` row filter this section used to set (applied
-- 2026-07-16) did not help: wal2json ignores publication row filters, so the
-- decode cost was unchanged. Removing the table is the only fix.
--   Rollback (re-publish PvP rows for a Realtime client):
--     alter publication supabase_realtime add table public.kv_store where (key like 'pvp:%');
-- Idempotent and guarded: Supabase creates `supabase_realtime` on every project,
-- a bare Postgres may lack it, and the table may already be out.
do $$
begin
    if exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kv_store'
    ) then
        alter publication supabase_realtime drop table public.kv_store;
    end if;
end $$;

-- ── kv_set_nx — atomic set-if-not-exists for PvP lock semantics ──────────────

create or replace function public.kv_set_nx(
    p_key       text,
    p_value     jsonb,
    p_expires_at timestamptz default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
    -- Treat an expired row as non-existent so a new lock can be acquired.
    delete from public.kv_store
    where key = p_key
      and expires_at is not null
      and expires_at <= now();

    insert into public.kv_store (key, value, expires_at, updated_at)
    values (p_key, p_value, p_expires_at, now());

    return true;
exception
    when unique_violation then
        return false;
end;
$$;

-- ── kv_incr — atomic fixed-window counter (rate limiter) ─────────────────────
-- Atomically increment a numeric counter and return the new value. Replaces the
-- rate limiter's previous non-atomic get-then-set, which let concurrent requests
-- in the same window all read the same count and all pass the limit check. The
-- key embeds the window index, so expires_at is set once (on the first hit of a
-- window) and the row self-cleans; kv_delete_expired() / pg_cron purges it.

-- Atomic full-value JSON compare-and-set. A NULL expected value means the
-- live row must be absent; expired rows count as absent.
create or replace function public.kv_compare_set(
    p_key        text,
    p_expected   jsonb,
    p_value      jsonb,
    p_expires_at timestamptz default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
    v_changed integer;
begin
    if p_expected is null then
        delete from public.kv_store
        where key = p_key
          and expires_at is not null
          and expires_at <= now();

        insert into public.kv_store (key, value, expires_at, updated_at)
        values (p_key, p_value, p_expires_at, now())
        on conflict (key) do nothing;
    else
        update public.kv_store
        set value = p_value,
            expires_at = p_expires_at,
            updated_at = now()
        where key = p_key
          and value = p_expected
          and (expires_at is null or expires_at > now());
    end if;

    get diagnostics v_changed = row_count;
    return v_changed = 1;
end;
$$;

create or replace function public.kv_incr(
    p_key        text,
    p_expires_at timestamptz default null
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
    v_new bigint;
begin
    -- An expired row starts a fresh window.
    delete from public.kv_store
    where key = p_key
      and expires_at is not null
      and expires_at <= now();

    insert into public.kv_store (key, value, expires_at, updated_at)
    values (p_key, to_jsonb(1::bigint), p_expires_at, now())
    on conflict (key) do update
        set value      = to_jsonb(coalesce(nullif(kv_store.value, 'null'::jsonb)::text::bigint, 0) + 1),
            updated_at = now()
    returning value::text::bigint into v_new;

    return v_new;
end;
$$;

-- ── kv_hset — atomic hash-set (merge JSON fields) ────────────────────────────
-- Equivalent to Redis HSET: inserts the hash or merges new fields into it.
-- Uses Postgres || operator to merge JSONB objects in a single statement.
--
-- A merge that changes nothing writes nothing (2026-10-12). Every write of a
-- jsonb row rewrites the WHOLE row (and its TOAST and WAL), and hash rows are
-- the big shared ones: the player registry, sleeper camps, image manifests of
-- 10-20 MB. jsonb equality is structural, so key order never forces a write;
-- updated_at then keeps the time of the last real change.

create or replace function public.kv_hset(
    p_key    text,
    p_fields jsonb
)
returns void
language sql
set search_path = ''
as $$
    insert into public.kv_store (key, value, updated_at)
    values (p_key, p_fields, now())
    on conflict (key) do update
        set value      = kv_store.value || excluded.value,
            updated_at = now()
        where (kv_store.value || excluded.value) is distinct from kv_store.value;
$$;

-- ── kv_hdel — atomic hash-delete (remove specific JSON fields) ───────────────
-- Equivalent to Redis HDEL: removes named fields from the stored JSON object.
--
-- One statement (2026-10-12). The old version read the row, removed the fields
-- in PL/pgSQL, then wrote it back: an hset committing in between was silently
-- undone, and a delete of fields the row lacked still rewrote the whole row
-- (nearly every sleeper-camp beat). The UPDATE re-checks its WHERE against the
-- latest row under the row lock, and touches nothing when no field is present.

create or replace function public.kv_hdel(
    p_key    text,
    p_fields text[]
)
returns void
language sql
set search_path = ''
as $$
    update public.kv_store
    set value      = value - p_fields,
        updated_at = now()
    where key = p_key
      and value ?| p_fields;
$$;

-- ── kv_delete_expired — periodic cleanup ─────────────────────────────────────
-- Run periodically (e.g. in Supabase cron or pg_cron) to purge stale data.
-- Example schedule: select public.kv_delete_expired(); -- every 5 minutes.

create or replace function public.kv_delete_expired()
returns integer
language plpgsql
set search_path = ''
as $$
declare
    deleted_count integer;
begin
    delete from public.kv_store
    where expires_at is not null
      and expires_at <= now();

    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$;

-- ── Scheduled cleanup via pg_cron ─────────────────────────────────────────────
-- ENABLED. Without this, expired rows are only evicted lazily on read, so the
-- table accumulates dead rows indefinitely — the live DB hit 20k+ expired rows
-- (≈99% `ratelimit:` churn) for ~2.5 MB of live data in a 56 MB table. Every 2
-- minutes keeps the high-churn rate-limit windows bounded. Idempotent: re-running
-- cron.schedule with the same job name updates the existing schedule.

create extension if not exists pg_cron;

select cron.schedule(
    'kv-cleanup',
    '*/2 * * * *',            -- every 2 minutes
    $$ select public.kv_delete_expired(); $$
);

-- ── Data API RPC hardening ───────────────────────────────────────────────────
-- PostgreSQL grants EXECUTE on newly-created functions to PUBLIC by default.
-- These helpers mutate the game's KV table and are called only by the trusted
-- API, as shinobix_app (DATABASE_URL) or the service role (REST fallback). Do
-- not leave them callable through the anonymous/authenticated Data API. They are
-- SECURITY INVOKER; keep them that way, so a stray grant still cannot reach the
-- table. This section is idempotent. Production was missing three of these
-- revokes until 2026-10-30 (supabase-migrations/2026-10-30_revoke_kv_function_browser_execute.sql).
revoke all on function public.kv_set_nx(text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.kv_compare_set(text, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.kv_incr(text, timestamptz) from public, anon, authenticated;
revoke all on function public.kv_hset(text, jsonb) from public, anon, authenticated;
revoke all on function public.kv_hdel(text, text[]) from public, anon, authenticated;
revoke all on function public.kv_delete_expired() from public, anon, authenticated;

grant execute on function public.kv_set_nx(text, jsonb, timestamptz) to service_role;
grant execute on function public.kv_compare_set(text, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.kv_incr(text, timestamptz) to service_role;
grant execute on function public.kv_hset(text, jsonb) to service_role;
grant execute on function public.kv_hdel(text, text[]) to service_role;
grant execute on function public.kv_delete_expired() to service_role;

grant execute on function public.kv_set_nx(text, jsonb, timestamptz) to shinobix_app;
grant execute on function public.kv_incr(text, timestamptz) to shinobix_app;
grant execute on function public.kv_hset(text, jsonb) to shinobix_app;
grant execute on function public.kv_hdel(text, text[]) to shinobix_app;
grant execute on function public.kv_delete_expired() to shinobix_app;
