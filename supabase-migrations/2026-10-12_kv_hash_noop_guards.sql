-- kv_hset / kv_hdel stop rewriting rows they don't change (2026-10-12). Idempotent.
--
-- Every write of a jsonb row rewrites the WHOLE row, its TOAST and its WAL, and
-- hash rows are the big shared ones (player registry, sleeper camps, image
-- manifests of 10-20 MB). In production these two functions were ~14% of
-- database time.
--
--   kv_hset: a merge that changes nothing (same values, any key order) is
--            skipped by the ON CONFLICT ... WHERE guard.
--   kv_hdel: one UPDATE instead of read-then-write. It skips rows that hold
--            none of the fields, and an hset committing between the old
--            function's read and write can no longer be undone.
--
-- Same signatures and return types, so callers and grants are unchanged; the
-- grants are re-asserted anyway. Rollback: re-run the previous definitions from
-- git history of supabase-schema.sql.

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

revoke all on function public.kv_hset(text, jsonb) from public, anon, authenticated;
revoke all on function public.kv_hdel(text, text[]) from public, anon, authenticated;
grant execute on function public.kv_hset(text, jsonb) to service_role;
grant execute on function public.kv_hdel(text, text[]) to service_role;
