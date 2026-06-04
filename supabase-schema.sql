-- ============================================================
-- ShinobiX — Supabase KV store schema
-- Run this in the Supabase SQL editor (idempotent — safe to re-run).
--
-- Access model:
--   * The server uses SUPABASE_SERVICE_ROLE_KEY which BYPASSES RLS — it
--     can read/write any key. Never expose this key to the client.
--   * The browser uses VITE_SUPABASE_ANON_KEY for Realtime ONLY. RLS
--     allows it to SELECT a strict allowlist of key prefixes that the
--     client subscribes to via Supabase Realtime (PvP sessions,
--     clan-war tile-card duels, incoming duel challenges). Everything
--     else (player saves, auth, IP/fingerprint maps, presence, etc.)
--     stays invisible to the anon role.
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
--   * `save:%` rows are ALREADY service-role-only: they are not in the anon
--     SELECT allowlist below, and the `authenticated` role has NO policy AND
--     (as of 2026-06-01) NO grant either, so RLS denies it every row.
--   * Field-level redaction of the anon-readable prefixes (pvp/cw-tilecards/
--     challenges) is done in the app layer — RLS is row-level and cannot
--     project inside the `value` jsonb. See the PvP/guard projection helpers.
-- Defense-in-depth (APPLIED 2026-06-01, migration
-- `harden_kv_store_revoke_authenticated_select`): the `authenticated` role is
--   now granted NOTHING on kv_store (see the `revoke all … from authenticated`
--   below, with no re-grant). It previously carried a harmless-but-latent
--   `grant select` that would have exposed all rows if RLS were ever disabled;
--   the app never uses that role, so the grant was revoked. The `anon` SELECT
--   grant/policy is deliberately untouched — live Realtime depends on it.
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
-- RLS MUST be ENABLED. Service-role bypasses it for server-side reads/writes;
-- the anon role is what the browser uses and we want a narrow allowlist.
--
-- Anon allowlist:
--   pvp:*            — PvP session state (intentionally shared between fighters and spectators)
--   cw-tilecards:*   — Clan-war tile-card duel state (same rationale)
--   challenges:*     — Per-player incoming duel-challenge inbox
--
-- Adding a new client-subscribed key prefix? Add it to the USING clause
-- of the SELECT policy below AND update lib/realtime.ts. Keep both in sync.

alter table public.kv_store enable row level security;

-- Drop any prior policies before re-creating so this script is idempotent.
drop policy if exists "anon_read_pvp_realtime" on public.kv_store;
drop policy if exists "kv_store_anon_select"   on public.kv_store;

-- Anon SELECT — strict prefix allowlist. Nothing else is readable.
create policy "kv_store_anon_select"
    on public.kv_store
    for select
    to anon
    using (
        key like 'pvp:%'
        or key like 'cw-tilecards:%'
        or key like 'challenges:%'
    );

-- Belt-and-suspenders: also revoke broad table grants from anon so that
-- even if the policy is ever dropped, anon can't read/write anything.
-- The SELECT policy above re-grants the narrow allowlist.
revoke all      on public.kv_store from anon;
grant  select   on public.kv_store to   anon;
-- audit #27 hardening (applied to prod 2026-06-01): the app never uses the
-- `authenticated` role (players are `anon` via Realtime; the server is
-- `service_role`), so grant it NOTHING. RLS already denied it every row by
-- deny-by-default; revoking the grant also closes the "if RLS is ever disabled,
-- authenticated would see all rows" footgun. Do NOT re-add a grant here.
revoke all      on public.kv_store from authenticated;

-- ── Realtime publication (audit #13) ─────────────────────────────────────────
-- The browser subscribes to kv_store row changes via Supabase Realtime (see
-- shinobij.client/src/lib/realtime.ts + the PvP battle screen). For those WS
-- pushes to arrive, kv_store must be a member of the `supabase_realtime`
-- publication AND publish full row images on UPDATE (so the new session JSON
-- rides along). Without this the channel still SUBSCRIBES fine but never
-- delivers a payload — the silent failure behind audit #11. The client now
-- falls back to SSE in that case, so this is a latency optimisation, not a
-- correctness requirement, but enabling it restores the ~30-80ms WS path.
--
-- Idempotent: REPLICA IDENTITY FULL is a no-op if already set, and the table is
-- only added to the publication when not already a member. `supabase_realtime`
-- is created by Supabase on every project; guard in case a bare Postgres lacks it.
alter table public.kv_store replica identity full;
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename  = 'kv_store'
       )
    then
        alter publication supabase_realtime add table public.kv_store;
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

-- ── kv_hset — atomic hash-set (merge JSON fields) ────────────────────────────
-- Equivalent to Redis HSET: inserts the hash or merges new fields into it.
-- Uses Postgres || operator to merge JSONB objects in a single statement.

create or replace function public.kv_hset(
    p_key    text,
    p_fields jsonb
)
returns void
language sql
as $$
    insert into public.kv_store (key, value, updated_at)
    values (p_key, p_fields, now())
    on conflict (key) do update
        set value      = kv_store.value || excluded.value,
            updated_at = now();
$$;

-- ── kv_hdel — atomic hash-delete (remove specific JSON fields) ───────────────
-- Equivalent to Redis HDEL: removes named fields from the stored JSON object.

create or replace function public.kv_hdel(
    p_key    text,
    p_fields text[]
)
returns void
language plpgsql
as $$
declare
    v_current jsonb;
    v_new     jsonb;
    v_field   text;
begin
    select value into v_current
    from public.kv_store
    where key = p_key;

    if not found then
        return;  -- Nothing to delete from.
    end if;

    v_new := v_current;
    foreach v_field in array p_fields loop
        v_new := v_new - v_field;
    end loop;

    update public.kv_store
    set value      = v_new,
        updated_at = now()
    where key = p_key;
end;
$$;

-- ── kv_delete_expired — periodic cleanup ─────────────────────────────────────
-- Run periodically (e.g. in Supabase cron or pg_cron) to purge stale data.
-- Example schedule: select public.kv_delete_expired(); -- every 5 minutes.

create or replace function public.kv_delete_expired()
returns integer
language plpgsql
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

-- ── Optional: scheduled cleanup via pg_cron ───────────────────────────────────
-- Uncomment if pg_cron is enabled in your Supabase project (Database → Extensions).
--
-- select cron.schedule(
--     'kv-cleanup',
--     '*/5 * * * *',            -- every 5 minutes
--     $$ select public.kv_delete_expired(); $$
-- );
