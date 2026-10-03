import type { KvLike } from './_storage.js';
import { assertKvLockContext, currentKvLockContext, LockOwnershipLostError, poisonKvLockContext } from './_kv-lock-context.js';

export class StorageLockCapabilityError extends Error {
    constructor() {
        super('Storage lock fencing is unavailable. Install the reviewed kv_guarded_operation RPC before serving protected operations.');
        this.name = 'StorageLockCapabilityError';
    }
}

export type GuardedRestRequest = {
    p_leases: Array<{ key: string; owner: string }>;
    p_operation: string;
    p_args: Record<string, unknown>;
};
export type GuardedRestResult = { data: unknown; error: { code?: string; message?: string } | null };

/** Wrap only genuine adapter members; assigned test doubles keep their signatures. */
export function makeGuardedRestKv(store: KvLike, rpc: (request: GuardedRestRequest) => Promise<GuardedRestResult>, sqlPattern: (pattern: string) => string, committed?: (...keys: string[]) => void): KvLike {
    const originals = new Map(Reflect.ownKeys(store).map(key => [key, Reflect.get(store, key)]));
    return new Proxy(store, {
        get(target, property, receiver) {
            const member = Reflect.get(target, property, receiver) as unknown;
            if (typeof member !== 'function' || member !== originals.get(property)) return member;
            return async (...args: unknown[]) => {
                const context = currentKvLockContext();
                if (!context) return Reflect.apply(member, target, args);
                assertKvLockContext(context);
                const key = args[0] as string;
                const options = args[property === 'compareSet' ? 3 : 2] as { ex?: number; nx?: boolean } | undefined;
                let operation = String(property);
                let request: Record<string, unknown>;
                switch (property) {
                    case 'get': case 'hgetall': operation = 'get'; request = { key }; break;
                    case 'set': request = { key, value: args[1], nx: options?.nx ?? false, expiresAt: options?.ex ? new Date(Date.now() + options.ex * 1000).toISOString() : null }; break;
                    case 'compareSet': request = { key, expected: args[1], value: args[2], expiresAt: options?.ex ? new Date(Date.now() + options.ex * 1000).toISOString() : null }; break;
                    case 'del': case 'mget': request = { keys: args }; break;
                    case 'delIfEqual': request = { key, expected: args[1] }; break;
                    case 'incr': {
                        const expiry = args[1] as { ex?: number } | undefined;
                        request = { key, expiresAt: expiry?.ex ? new Date(Date.now() + expiry.ex * 1000).toISOString() : null }; break;
                    }
                    case 'keys': request = { pattern: sqlPattern(key) }; break;
                    case 'hkeys': request = { key, nonEmptyStrings: (args[1] as { nonEmptyStrings?: boolean } | undefined)?.nonEmptyStrings ?? false }; break;
                    case 'hset': request = { key, fields: args[1] }; break;
                    case 'hdel': request = { key, fields: args.slice(1) }; break;
                    default: throw new StorageLockCapabilityError();
                }
                const mutationKeys = ['set', 'compareSet', 'delIfEqual', 'incr', 'hset', 'hdel'].includes(String(property))
                    ? [key] : property === 'del' ? args as string[] : [];
                try {
                    const { data, error } = await rpc({
                        p_leases: context.leases.map(lease => ({ key: lease.key, owner: lease.owner })),
                        p_operation: operation,
                        p_args: request,
                    });
                    if (error) {
                        if (error.code === '55000' && error.message?.includes('KV_LOCK_LOST')) throw new LockOwnershipLostError();
                        if (error.code === 'PGRST202' || error.code === '42883') throw new StorageLockCapabilityError();
                        throw new Error(`Guarded storage operation failed (${error.code ?? 'transport'}).`);
                    }
                    assertKvLockContext(context);
                    // The RPC response confirms commit. Do not notify an
                    // ambiguous response or an unsuccessful NX/CAS condition.
                    const changed = property === 'set' ? data === 'OK'
                        : property === 'compareSet' || property === 'delIfEqual' ? data === true
                            : property === 'incr' || Number(data) > 0;
                    if (mutationKeys.length && changed) committed?.(...mutationKeys);
                    return property === 'incr' ? Number(data) : data;
                } catch (error) {
                    throw poisonKvLockContext(context, error);
                }
            };
        },
    });
}
