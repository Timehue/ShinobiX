import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName, clanRecordKey } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';

/*
 * /api/clan/treasury/transfer — POST only
 *
 * Atomic clan-leadership gift endpoint (audit #18). Mirrors
 * api/village/treasury/transfer.ts but moves from the clan treasury (stored in
 * the shared `save:clan-<slug>` record) to a member's save.
 *
 * The old client flow (App.tsx sendClanCurrency/sendClanItem) deducted from
 * clanData.treasury and called grantCurrencyToPlayer(), which PATCHes the
 * recipient's save — and /api/save 403s any cross-player POST. So clan
 * leadership gifts SILENTLY did nothing for non-admins. This endpoint
 * impersonates both ends server-side under per-row locks: it verifies the
 * caller is clan leadership and the recipient is a clan member, credits the
 * recipient, then deducts the treasury, and writes an audit-log entry.
 *
 * Body (currency): { clanName, recipientName, currency, amount }
 * Body (item):     { clanName, recipientName, itemId }
 */

const AUDIT_LOG_PREFIX = 'audit:clan-treasury:';

type TransferCurrency = 'ryo' | 'fateShards' | 'boneCharms' | 'auraStones' | 'mythicSeals';
const ALLOWED_CURRENCIES: ReadonlySet<TransferCurrency> = new Set<TransferCurrency>([
    'ryo', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals',
]);
// Per-call ceilings mirror the village-gift caps so a compromised/abusive
// leader can't dump the whole treasury into one account in a single click.
const MAX_GIFT_PER_CALL: Record<TransferCurrency, number> = {
    ryo: 200_000, fateShards: 200, boneCharms: 200, auraStones: 200, mythicSeals: 50,
};

// Roles allowed to send treasury — matches the client's canManageClan().
const MANAGE_ROLES = new Set(['Founder', 'Leader', 'Officer']);

type ClanMember = { name?: string; isFounder?: boolean; battleContrib?: number; eventContrib?: number; missionContrib?: number };
type ClanRecord = {
    founderName?: string;
    members?: ClanMember[];
    roleOverrides?: Record<string, string>;
    treasury?: Record<string, unknown> & { items?: Array<{ itemId: string; count: number }> };
    [k: string]: unknown;
};
type CharacterRow = Record<string, unknown> & { inventory?: string[] };

function contribTotal(m: ClanMember): number {
    return Number(m.battleContrib ?? 0) * 10 + Number(m.eventContrib ?? 0) * 5 + Number(m.missionContrib ?? 0) * 2;
}

// Server port of App.tsx clanRoleOf: explicit roleOverrides win, then the
// founder, then a contribution-ranked Leader/Officer/… ladder. Returns '' for
// a non-member. Kept in sync with clanRoleOf + clanContribTotal (clan-math.ts).
function roleOfBySlug(rec: ClanRecord, callerSlug: string): string {
    const members = Array.isArray(rec.members) ? rec.members : [];
    const me = members.find(m => safeName(String(m.name ?? '')) === callerSlug);
    if (!me) return '';
    const founderSlug = safeName(String(rec.founderName ?? ''));
    const override = me.name ? (rec.roleOverrides ?? {})[me.name] : undefined;
    if (override) return String(override);
    if (founderSlug === callerSlug || me.isFounder) return 'Founder';
    const sorted = members
        .filter(m => safeName(String(m.name ?? '')) !== founderSlug)
        .sort((a, b) => contribTotal(b) - contribTotal(a));
    const idx = sorted.findIndex(m => safeName(String(m.name ?? '')) === callerSlug);
    if (idx === 0) return 'Leader';
    if (idx > 0 && idx <= 2) return 'Officer';
    if (idx > 2 && idx <= 4) return 'Elite Member';
    return 'Member';
}

function removeOneItem(items: Array<{ itemId: string; count: number }>, itemId: string): Array<{ itemId: string; count: number }> {
    const out: Array<{ itemId: string; count: number }> = [];
    let removed = false;
    for (const s of items) {
        if (!removed && s.itemId === itemId && s.count > 0) {
            const nextCount = s.count - 1;
            if (nextCount > 0) out.push({ ...s, count: nextCount });
            removed = true;
            continue;
        }
        out.push(s);
    }
    return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    const rlName = identity.admin ? undefined : identity.name;
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-treasury-transfer', 30, 60_000, rlName))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const clanName = typeof body.clanName === 'string' ? body.clanName.trim() : '';
        const recipientName = safeName(typeof body.recipientName === 'string' ? body.recipientName : '');
        const currency = typeof body.currency === 'string' ? body.currency : undefined;
        const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : undefined;
        const amount = Math.max(0, Math.floor(Number(body.amount)));

        if (!clanName || !recipientName) {
            return res.status(400).json({ error: 'Missing clanName or recipientName.' });
        }
        const isCurrency = !!currency;
        const isItem = !!itemId;
        if (isCurrency === isItem) {
            return res.status(400).json({ error: 'Must provide exactly one of currency or itemId.' });
        }
        if (isCurrency) {
            if (!ALLOWED_CURRENCIES.has(currency as TransferCurrency)) {
                return res.status(400).json({ error: `Unsupported currency: ${currency}` });
            }
            if (amount < 1) return res.status(400).json({ error: 'amount must be ≥ 1.' });
            const cap = MAX_GIFT_PER_CALL[currency as TransferCurrency];
            if (amount > cap) return res.status(400).json({ error: `amount exceeds per-call cap of ${cap}.` });
        }

        const clanKey = clanRecordKey(clanName);     // save:clan-<slug>
        const recipientKey = `save:${recipientName}`;
        if (clanKey === recipientKey) {
            return res.status(400).json({ error: 'Invalid recipient.' });
        }

        // Lock BOTH rows (clan record + recipient save) in deterministic key
        // order so two transfers — or a transfer vs. the recipient's autosave —
        // can't deadlock. failClosed: a contention abort writes nothing and the
        // client retries, never a partial credit/deduct.
        const [firstKey, secondKey] = [clanKey, recipientKey].sort();
        const result = await withKvLock(firstKey, () => withKvLock(secondKey, async () => {
            const rec = await kv.get<ClanRecord>(clanKey);
            if (!rec) return { ok: false as const, status: 404, error: 'Clan not found.' };

            // Authorization: caller must be clan leadership (admin bypasses).
            if (!identity.admin) {
                const role = roleOfBySlug(rec, identity.name);
                if (!MANAGE_ROLES.has(role)) {
                    return { ok: false as const, status: 403, error: 'Only clan leadership can send treasury resources.' };
                }
            }

            // Recipient must be a member of THIS clan (no siphoning to outsiders).
            const members = Array.isArray(rec.members) ? rec.members : [];
            const isMember = members.some(m => safeName(String(m.name ?? '')) === recipientName);
            if (!isMember) {
                return { ok: false as const, status: 403, error: 'Recipient is not a member of this clan.' };
            }

            const recipientSave = await kv.get<Record<string, unknown>>(recipientKey);
            const recipientChar = (recipientSave?.character ?? null) as CharacterRow | null;
            if (!recipientSave || !recipientChar) {
                return { ok: false as const, status: 404, error: 'Recipient save not found.' };
            }

            const treasury = (rec.treasury ?? {}) as Record<string, unknown> & { items?: Array<{ itemId: string; count: number }> };

            if (isCurrency) {
                const c = currency as TransferCurrency;
                const available = Math.max(0, Number(treasury[c] ?? 0));
                if (available < amount) {
                    return { ok: false as const, status: 400, error: `Insufficient treasury ${c} (have ${available}, need ${amount}).` };
                }
                // Credit recipient first, then deduct — a credit failure can't
                // leave the treasury short (both are under the same locks here).
                const nextChar = { ...recipientChar, [c]: Math.max(0, Number(recipientChar[c] ?? 0)) + amount };
                await kv.set(recipientKey, { ...recipientSave, character: nextChar });
                await kv.set(clanKey, { ...rec, treasury: { ...treasury, [c]: available - amount } });
                return { ok: true as const, currency: c, amount };
            }

            // Item transfer.
            const items = Array.isArray(treasury.items) ? treasury.items : [];
            const stack = items.find(s => s.itemId === itemId);
            if (!stack || stack.count < 1) {
                return { ok: false as const, status: 400, error: 'Item not in clan treasury.' };
            }
            const nextInv = Array.isArray(recipientChar.inventory) ? [...recipientChar.inventory, itemId!] : [itemId!];
            await kv.set(recipientKey, { ...recipientSave, character: { ...recipientChar, inventory: nextInv } });
            await kv.set(clanKey, { ...rec, treasury: { ...treasury, items: removeOneItem(items, itemId!) } });
            return { ok: true as const, itemId };
        }, { failClosed: true }), { failClosed: true });

        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }

        // Audit log (30-day TTL) for abuse review.
        await kv.set(`${AUDIT_LOG_PREFIX}${safeName(clanName)}:${Date.now()}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            clanName,
            recipientName,
            ...('currency' in result ? { currency: result.currency, amount: result.amount } : {}),
            ...('itemId' in result ? { itemId: result.itemId } : {}),
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);

        return res.status(200).json(result);
    } catch (err) {
        console.error('[clan/treasury-transfer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
