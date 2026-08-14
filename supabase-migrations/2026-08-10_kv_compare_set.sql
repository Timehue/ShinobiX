-- Atomic full-JSON compare-and-set used by crash-recoverable cross-row sagas.
-- Apply before deploying code that calls kv.compareSet(). Idempotent.

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

revoke all on function public.kv_compare_set(text, jsonb, jsonb, timestamptz)
from public, anon, authenticated;
grant execute on function public.kv_compare_set(text, jsonb, jsonb, timestamptz)
to service_role;
