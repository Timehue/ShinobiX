import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName, clanRecordKey } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { writeVersionedPlayerSave } from '../../save/_mutate-player-save.js';
import { settleCrossKeyTransfer, SettlementValidationError } from '../../_cross-key-settlement.js';
import { planTreasuryGift } from '../../_treasury-gift-tax.js';
import { hasRecentIpOrFpOverlap } from '../../_player-ips.js';
import { settlementFingerprint } from '../../_durable-settlement.js';

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
    const isAdmin = identity.admin;
    const actorName = isAdmin ? undefined : identity.name;

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
        // Reserve-first durable settlement. The request id is accepted from
        // the client for retry convergence; old clients get a deterministic
        // fingerprint so an identical retry still cannot move value twice.
        const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(body.requestId.trim())
            ? body.requestId.trim()
            : settlementFingerprint({ clanName: safeName(clanName), recipientName, currency: currency ?? '', itemId: itemId ?? '', amount });
        const fingerprint = settlementFingerprint({ operation: 'clan-treasury-transfer', clanName: safeName(clanName), recipientName, currency: currency ?? '', itemId: itemId ?? '', amount });
        const transfer = await settleCrossKeyTransfer<ClanRecord>({
            operationType: 'clan-treasury-transfer',
            idempotencyKey: requestId,
            fingerprint,
            actorIds: [actorName ?? 'admin', safeName(clanName), recipientName],
            resource: isCurrency ? String(currency) : `item:${itemId}`,
            amount: isCurrency ? amount : 1,
            sourceKey: clanKey,
            recipientKey,
            loadSource: () => kv.get<ClanRecord>(clanKey),
            validateSource: (source) => {
                if (!isAdmin && !MANAGE_ROLES.has(roleOfBySlug(source, actorName!))) {
                    throw new SettlementValidationError(403, 'Only clan leadership can send treasury resources.');
                }
                const members = Array.isArray(source.members) ? source.members : [];
                if (!members.some((member) => safeName(String(member.name ?? '')) === recipientName)) {
                    throw new SettlementValidationError(403, 'Recipient is not a member of this clan.');
                }
                const treasury = (source.treasury ?? {}) as Record<string, unknown> & { items?: Array<{ itemId: string; count: number }> };
                if (isCurrency) {
                    const available = Math.max(0, Number(treasury[currency as TransferCurrency] ?? 0));
                    if (available < amount) throw new SettlementValidationError(400, `Insufficient treasury ${currency} (have ${available}, need ${amount}).`);
                } else {
                    const stack = (Array.isArray(treasury.items) ? treasury.items : []).find((entry) => entry.itemId === itemId);
                    if (!stack || stack.count < 1) throw new SettlementValidationError(400, 'Item not in clan treasury.');
                }
            },
            debitSource: (source, receipt) => {
                const treasury = (source.treasury ?? {}) as Record<string, unknown> & { items?: Array<{ itemId: string; count: number }> };
                if (isCurrency) {
                    const key = currency as TransferCurrency;
                    const available = Math.max(0, Number(treasury[key] ?? 0));
                    return {
                        ...source,
                        treasury: { ...treasury, [key]: available - amount },
                        settlementReceipts: [receipt, ...(Array.isArray(source.settlementReceipts) ? source.settlementReceipts : [])].slice(0, 100),
                    };
                }
                const items = Array.isArray(treasury.items) ? treasury.items : [];
                return {
                    ...source,
                    treasury: { ...treasury, items: removeOneItem(items, itemId!) },
                    settlementReceipts: [receipt, ...(Array.isArray(source.settlementReceipts) ? source.settlementReceipts : [])].slice(0, 100),
                };
            },
            saveSource: async (source) => { await kv.set(clanKey, source); },
            loadRecipient: async () => {
                const record = await kv.get<Record<string, unknown>>(recipientKey);
                const character = (record?.character ?? null) as CharacterRow | null;
                return record && character ? { record, character } : null;
            },
            validateRecipient: async ({ character }) => {
                if (!isAdmin && safeName(String(character.clan ?? '')) !== safeName(clanName)) {
                    throw new SettlementValidationError(403, 'Recipient is no longer a member of this clan.');
                }
                if (!isAdmin && actorName) {
                    // Shared-connection guard, matching /api/player/trade. Founding
                    // a clan is free, so without this the donate->gift round trip is
                    // a zero-cost funnel to your own alt. Fails OPEN on error
                    // (ruling 8: player experience first).
                    try {
                        if (await hasRecentIpOrFpOverlap(actorName, recipientName)) {
                            throw new SettlementValidationError(403, "You can't gift treasury resources to someone sharing your connection.");
                        }
                    } catch (err) { if (err instanceof SettlementValidationError) throw err; }
                }
            },
            creditRecipient: (character) => {
                if (isCurrency) {
                    const key = currency as TransferCurrency;
                    // Treasury gift tax (api/_treasury-gift-tax.ts). The pool loses
                    // the full amount; the recipient receives it minus a burn, so a
                    // free clan can no longer be a 0% wealth-laundering channel that
                    // undercuts the taxed /api/player/trade. Honor Seals are exempt.
                    const split = planTreasuryGift(key, amount);
                    const next = { ...character, [key]: Math.max(0, Number(character[key] ?? 0)) + split.credit };
                    return { character: next, result: { currency: key, amount: split.credit, burned: split.burned } };
                }
                const inventory = Array.isArray(character.inventory) ? [...character.inventory] : [];
                inventory.push(itemId!);
                return { character: { ...character, inventory }, result: { itemId } };
            },
            saveRecipient: async (record, character) => (await writeVersionedPlayerSave(recipientKey, record, character)).record,
        });
        await kv.set(`${AUDIT_LOG_PREFIX}${safeName(clanName)}:${Date.now()}`, {
            ts: Date.now(),
            actor: actorName ?? 'admin',
            clanName,
            recipientName,
            ...('currency' in transfer.result ? { currency: transfer.result.currency, amount: transfer.result.amount } : {}),
            ...('itemId' in transfer.result ? { itemId: transfer.result.itemId } : {}),
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        return res.status(200).json({ ok: true, ...transfer.result });
    } catch (err) {
        if (err instanceof SettlementValidationError) {
            return res.status(err.status).json({ error: err.message });
        }
        console.error('[clan/treasury-transfer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
