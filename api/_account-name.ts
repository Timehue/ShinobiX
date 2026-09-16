import { kv } from './_storage.js';
import { safeName } from './_utils.js';

/** Login names are mutable. Save keys, tokens, clans and battle references use
 * the original account ID for the lifetime of the character. Reservations never
 * authenticate by themselves: the committed save decides which login is active. */
export const accountNameKey = (name: string) => `account-name:${safeName(name)}`;

/** User-entered recipients resolve to stable references before social/economy
 * writes. Existing IDs remain valid for old records and buttons. */
export async function resolvePlayerReference(input: string): Promise<string> {
    const requested = safeName(input);
    const owner = await kv.get<string>(accountNameKey(requested));
    if (!owner) return input;
    const save = await kv.get<{ character?: { name?: string; accountName?: string } }>(`save:${safeName(owner)}`);
    return safeName(save?.character?.accountName || '') === requested ? (save?.character?.name || owner) : input;
}

export async function resolveAccountLogin(input: string): Promise<string | null> {
    const requested = safeName(input);
    const owner = await kv.get<string>(accountNameKey(requested));
    const id = owner ? safeName(owner) : requested;
    const save = await kv.get<{ character?: { name?: string; accountName?: string } }>(`save:${id}`);
    const current = safeName(save?.character?.accountName || id);
    // A reservation left by an interrupted rename is safe to retry, but cannot
    // be used to enter an account until its versioned save commits the new name.
    return current === requested ? (save?.character?.name || id) : null;
}
