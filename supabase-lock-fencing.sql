-- Approved migration source, prepared locally on 2026-10-02. Not applied live.
-- Install after supabase-schema.sql, before deploying fenced lock operations
-- through the Supabase REST backend. This adds one service-role-only function
-- and does not change tables, stored values, or browser access permissions.
create or replace function public.kv_guarded_operation(
    p_leases jsonb,
    p_operation text,
    p_args jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    lease record;
    expected jsonb;
    found integer := 0;
    result jsonb;
    affected integer;
    item_key text := p_args->>'key';
    expiry timestamptz := (p_args->>'expiresAt')::timestamptz;
    keys_array text[];
begin
    -- A read-only deployment capability probe; it grants no mutation authority.
    if p_operation = 'capability' then return '{"version":1}'::jsonb; end if;
    if jsonb_typeof(p_leases) is distinct from 'array' or jsonb_array_length(p_leases) < 1 then
        raise exception using errcode = '22023', message = 'KV_GUARD_REQUIRES_LEASES';
    end if;
    if exists (select 1 from jsonb_array_elements(p_leases) as l(value)
               where jsonb_typeof(l.value->'key') <> 'string'
                  or jsonb_typeof(l.value->'owner') <> 'string'
                  or coalesce(l.value->>'key', '') = '' or coalesce(l.value->>'owner', '') = '')
       or (select count(distinct l.value->>'key') from jsonb_array_elements(p_leases) as l(value)) <> jsonb_array_length(p_leases) then
        raise exception using errcode = '22023', message = 'KV_GUARD_INVALID_LEASES';
    end if;
    -- Owner-row locks last until this RPC transaction commits. Expiry is checked
    -- AFTER the row lock is acquired, using database wall time, not app time.
    for lease in
        select k.key, k.value, k.expires_at from public.kv_store as k
        where k.key in (select l.value->>'key' from jsonb_array_elements(p_leases) as l(value))
        order by k.key for share
    loop
        select l.value->'owner' into expected from jsonb_array_elements(p_leases) as l(value)
        where l.value->>'key' = lease.key;
        if lease.value is distinct from expected or lease.expires_at is null or lease.expires_at <= clock_timestamp() then
            raise exception using errcode = '55000', message = 'KV_LOCK_LOST';
        end if;
        found := found + 1;
    end loop;
    if found <> jsonb_array_length(p_leases) then
        raise exception using errcode = '55000', message = 'KV_LOCK_LOST';
    end if;

    case p_operation
    when 'get' then
        select value into result from public.kv_store where key = item_key
        and (expires_at is null or expires_at > clock_timestamp());
        return result;
    when 'set' then
        if coalesce((p_args->>'nx')::boolean, false) then
            if public.kv_set_nx(item_key, p_args->'value', expiry) then return '"OK"'::jsonb; end if;
            return null;
        end if;
        insert into public.kv_store(key, value, expires_at, updated_at)
        values(item_key, p_args->'value', expiry, clock_timestamp())
        on conflict(key) do update set value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at;
        return '"OK"'::jsonb;
    when 'compareSet' then
        if p_args->'expected' = 'null'::jsonb then
            insert into public.kv_store as current(key, value, expires_at, updated_at)
            values(item_key, p_args->'value', expiry, clock_timestamp())
            on conflict(key) do update set value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at
            where current.expires_at is not null and current.expires_at <= clock_timestamp();
        else
            update public.kv_store set value = p_args->'value', expires_at = expiry, updated_at = clock_timestamp()
            where key = item_key and value = p_args->'expected' and (expires_at is null or expires_at > clock_timestamp());
        end if;
        get diagnostics affected = row_count;
        return to_jsonb(affected > 0);
    when 'del' then
        keys_array := array(select jsonb_array_elements_text(p_args->'keys'));
        delete from public.kv_store where key = any(keys_array);
        get diagnostics affected = row_count;
        return to_jsonb(affected);
    when 'delIfEqual' then
        delete from public.kv_store where key = item_key and value = p_args->'expected';
        get diagnostics affected = row_count;
        return to_jsonb(affected > 0);
    when 'incr' then
        return to_jsonb(public.kv_incr(item_key, expiry));
    when 'hset' then
        perform public.kv_hset(item_key, p_args->'fields');
        return to_jsonb((select count(*) from jsonb_object_keys(p_args->'fields')));
    when 'hdel' then
        keys_array := array(select jsonb_array_elements_text(p_args->'fields'));
        perform public.kv_hdel(item_key, keys_array);
        return to_jsonb(cardinality(keys_array));
    when 'mget' then
        select coalesce(jsonb_agg(k.value order by requested.ordinality), '[]'::jsonb) into result
        from jsonb_array_elements_text(p_args->'keys') with ordinality as requested(key, ordinality)
        left join public.kv_store k on k.key = requested.key and (k.expires_at is null or k.expires_at > clock_timestamp());
        return result;
    when 'keys' then
        select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into result from public.kv_store
        where key like p_args->>'pattern' and (expires_at is null or expires_at > clock_timestamp());
        return result;
    when 'hkeys' then
        select value into result from public.kv_store where key = item_key
        and (expires_at is null or expires_at > clock_timestamp());
        if jsonb_typeof(result) is distinct from 'object' then return '[]'::jsonb; end if;
        select coalesce(jsonb_agg(field.key order by field.key), '[]'::jsonb) into result from jsonb_each(result) as field(key, value)
        where not coalesce((p_args->>'nonEmptyStrings')::boolean, false)
           or (jsonb_typeof(field.value) = 'string' and field.value <> '""'::jsonb);
        return result;
    else
        raise exception using errcode = '22023', message = 'KV_GUARD_UNKNOWN_OPERATION';
    end case;
end;
$$;

revoke all on function public.kv_guarded_operation(jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.kv_guarded_operation(jsonb, text, jsonb) to service_role;
