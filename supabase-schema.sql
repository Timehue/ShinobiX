-- ============================================================
-- ShinobiX — Supabase KV store schema
-- Run this once in the Supabase SQL editor.
-- RLS is intentionally disabled; access is through the
-- service-role key which is server-side only.
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

-- Disable RLS — table is backend-only (service key never reaches the browser).
alter table public.kv_store disable row level security;

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
