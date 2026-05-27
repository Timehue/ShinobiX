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
revoke all      on public.kv_store from authenticated;
grant  select   on public.kv_store to   authenticated;

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
