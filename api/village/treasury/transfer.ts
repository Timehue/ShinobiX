import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { writeVersionedPlayerSave } from '../../save/_mutate-player-save.js';
import { settleCrossKeyTransfer, SettlementValidationError } from '../../_cross-key-settlement.js';
import { planTreasuryGift } from '../../_treasury-gift-tax.js';
import { hasRecentIpOrFpOverlap } from '../../_player-ips.js';
import { settlementFingerprint } from '../../_durable-settlement.js';
import { recordEconomyTxn } from '../../_economy.js';

/*
 * /api/village/treasury/transfer  — POST only
 *
 * Atomic Kage-gift endpoint. The old flow was two separate writes:
 *   1) client deducts from villageState.treasury and POSTs villageState
 *   2) client PATCHes the recipient's save with the credited currency / item
 *
 * Step 2 fails for non-admin Kages because /api/save/<recipient> 403s any
 * cross-player POST. The net effect was that non-admin Kage gifts SILENTLY
 * did nothing — gifting was effectively admin-only. This endpoint is the
 * intended path: it impersonates both ends server-side, performs the
 * deduction + credit under per-row locks, and emits an audit-log entry.
 *
 * Request body shape (currency transfer):
 *   { village, recipientName, currency: 'ryo' | 'honorSeals' | ..., amount: number }
 *
 * Request body shape (item transfer):
 *   { village, recipientName, itemId: string }
 *
 * Caller MUST be the seated Kage of `village` (verified server-side via
 * the authoritative village:kage:<slug> KV row). Admins always pass.
 *
 * Rate-limited: 30 transfers / 60s per actor — far above any legitimate
 * Kage workflow, below any abuse loop. Locks held: village state row +
 * recipient save row. Net storage cost per call: 2 writes (treasury KV
 * + recipient save) + 1 audit-log write.
 */

const VILLAGE_STATE_PREFIX = 'game:village-state:';
const KAGE_KEY_PREFIX = 'village:kage:';
const AUDIT_LOG_PREFIX = 'audit:village-treasury:';

type TransferCurrency =
    | 'ryo'
    | 'honorSeals'
    | 'fateShards'
    | 'boneCharms'
    | 'auraStones'
    | 'mythicSeals';

const ALLOWED_CURRENCIES: ReadonlySet<TransferCurrency> = new Set<TransferCurrency>([
    'ryo', 'honorSeals', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals',
]);

// Per-call hard ceiling on a single gift amount. Mirrors the donation-side
// MAX_TREASURY_INCREASE caps in _village-state-validate.ts so an abusive
// Kage can't dump the entire treasury into one chosen account in a single
// click. Real gameplay never needs more than a few thousand per gift.
const MAX_GIFT_PER_CALL: Record<TransferCurrency, number> = {
    ryo: 200_000,
    honorSeals: 200,
    fateShards: 200,
    boneCharms: 200,
    auraStones: 200,
    mythicSeals: 50,
};

function villageSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function kageKey(village: string): string {
    return `${KAGE_KEY_PREFIX}${village.toLowerCase().replace(/\s+/g, '-')}`;
}

type VillageKageState = {
    kageSystemUnlocked?: boolean;
    seatedKage?: string;
};

type VillageStateRow = {
    treasury?: Record<string, unknown> & {
        items?: Array<{ itemId: string; count: number }>;
    };
    [key: string]: unknown;
};

type CharacterRow = {
    name?: string;
    village?: string;
    ryo?: number;
    honorSeals?: number;
    fateShards?: number;
    boneCharms?: number;
    auraStones?: number;
    mythicSeals?: number;
    inventory?: string[];
};

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

    // Rate-limit ALL transfers per actor. 30/min is comfortably above any
    // legit Kage workflow (a Kage manually gifting 30 villagers in a minute
    // is wildly atypical) but well below any abuse pattern.
    const rlName = identity.admin ? undefined : identity.name;
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-treasury-transfer', 30, 60_000, rlName))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const rawRecipient = typeof body.recipientName === 'string' ? body.recipientName : '';
        const recipientName = safeName(rawRecipient);
        const currency = typeof body.currency === 'string' ? body.currency : undefined;
        const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : undefined;
        const amountRaw = body.amount;
        const amount = Math.max(0, Math.floor(Number(amountRaw)));

        if (!village || !recipientName) {
            return res.status(400).json({ error: 'Missing village or recipientName.' });
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
            if (amount < 1) {
                return res.status(400).json({ error: 'amount must be ≥ 1.' });
            }
            const cap = MAX_GIFT_PER_CALL[currency as TransferCurrency];
            if (amount > cap) {
                return res.status(400).json({ error: `amount exceeds per-call cap of ${cap}.` });
            }
        }

        // ── Authorization: caller must be the seated Kage of `village` ─
        // The authoritative source is village:kage:<slug>, not the
        // game:village-state row (which players can lie about in the
        // POST body). Admin always passes.
        if (!identity.admin) {
            const kageState = await kv.get<VillageKageState>(kageKey(village));
            const seated = safeName(kageState?.seatedKage ?? '');
            if (!kageState?.kageSystemUnlocked || !seated || seated !== identity.name) {
                return res.status(403).json({ error: 'Only the seated Kage may transfer village treasury.' });
            }
        }

        // ── Recipient membership: must belong to this village ──────────
        // Stops a Kage from siphoning into an alt in another village.
        const recipientSaveKey = `save:${recipientName}`;
        const recipientSave = await kv.get<Record<string, unknown>>(recipientSaveKey);
        const recipientChar = (recipientSave?.character ?? null) as CharacterRow | null;
        if (!recipientChar) {
            return res.status(404).json({ error: 'Recipient save not found.' });
        }
        if (String(recipientChar.village ?? '').trim() !== village.trim() && !isAdmin) {
            return res.status(403).json({ error: 'Recipient is not a member of this village.' });
        }

        const villageStateKey = `${VILLAGE_STATE_PREFIX}${villageSlug(village)}`;
        const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(body.requestId.trim())
            ? body.requestId.trim()
            : settlementFingerprint({ village: villageSlug(village), recipientName, currency: currency ?? '', itemId: itemId ?? '', amount });
        const fingerprint = settlementFingerprint({ operation: 'village-treasury-transfer', village: villageSlug(village), recipientName, currency: currency ?? '', itemId: itemId ?? '', amount });
        const transfer = await settleCrossKeyTransfer<VillageStateRow>({
            operationType: 'village-treasury-transfer',
            idempotencyKey: requestId,
            fingerprint,
            actorIds: [actorName ?? 'admin', villageSlug(village), recipientName],
            resource: isCurrency ? String(currency) : `item:${itemId}`,
            amount: isCurrency ? amount : 1,
            sourceKey: villageStateKey,
            recipientKey: recipientSaveKey,
            loadSource: () => kv.get<VillageStateRow>(villageStateKey),
            validateSource: (source) => {
                const sourceTreasury = (source.treasury ?? {}) as Record<string, unknown> & { items?: Array<{ itemId: string; count: number }> };
                if (isCurrency) {
                    const available = Math.max(0, Number(sourceTreasury[currency as TransferCurrency] ?? 0));
                    if (available < amount) throw new SettlementValidationError(400, `Insufficient treasury ${currency} (have ${available}, need ${amount}).`);
                } else {
                    const stack = (Array.isArray(sourceTreasury.items) ? sourceTreasury.items : []).find((entry) => entry.itemId === itemId);
                    if (!stack || stack.count < 1) throw new SettlementValidationError(400, 'Item not in village treasury.');
                }
            },
            debitSource: (source, receipt) => {
                const sourceTreasury = (source.treasury ?? {}) as Record<string, unknown> & { items?: Array<{ itemId: string; count: number }> };
                if (isCurrency) {
                    const key = currency as TransferCurrency;
                    const available = Math.max(0, Number(sourceTreasury[key] ?? 0));
                    return { ...source, treasury: { ...sourceTreasury, [key]: available - amount }, settlementReceipts: [receipt, ...(Array.isArray(source.settlementReceipts) ? source.settlementReceipts : [])].slice(0, 100) };
                }
                const items = Array.isArray(sourceTreasury.items) ? sourceTreasury.items : [];
                return { ...source, treasury: { ...sourceTreasury, items: removeOneItem(items, itemId!) }, settlementReceipts: [receipt, ...(Array.isArray(source.settlementReceipts) ? source.settlementReceipts : [])].slice(0, 100) };
            },
            saveSource: async (source) => { await kv.set(villageStateKey, source); },
            loadRecipient: async () => {
                const record = await kv.get<Record<string, unknown>>(recipientSaveKey);
                const character = (record?.character ?? null) as CharacterRow | null;
                return record && character ? { record, character } : null;
            },
            validateRecipient: async ({ character }) => {
                if (!isAdmin && String(character.village ?? '').trim() !== village.trim()) throw new SettlementValidationError(403, 'Recipient is not a member of this village.');
                if (!isAdmin) {
                    // Shared-connection guard, matching /api/player/trade. Fails
                    // OPEN on error (ruling 8: player experience first) — a broken
                    // anti-cheat lookup must never block a legitimate Kage gift.
                    try {
                        if (actorName && await hasRecentIpOrFpOverlap(actorName, recipientName)) {
                            throw new SettlementValidationError(403, "You can't gift treasury resources to someone sharing your connection.");
                        }
                    } catch (err) { if (err instanceof SettlementValidationError) throw err; }
                    const freshKage = await kv.get<VillageKageState>(kageKey(village));
                    if (!freshKage?.kageSystemUnlocked || safeName(freshKage.seatedKage ?? '') !== actorName) throw new SettlementValidationError(403, 'Only the seated Kage may transfer village treasury.');
                }
            },
            creditRecipient: (character) => {
                if (isCurrency) {
                    const key = currency as TransferCurrency;
                    // Treasury gift tax (api/_treasury-gift-tax.ts). The pool loses the
                    // full amount; the recipient receives it minus a burn, so this
                    // channel can no longer undercut the taxed /api/player/trade.
                    // Honor Seals are exempt — that leg is village supply, not
                    // wealth transfer.
                    const split = planTreasuryGift(key, amount);
                    return { character: { ...character, [key]: Math.max(0, Number(character[key] ?? 0)) + split.credit }, result: { currency: key, amount: split.credit, burned: split.burned } };
                }
                const inventory = Array.isArray(character.inventory) ? [...character.inventory] : [];
                inventory.push(itemId!);
                return { character: { ...character, inventory }, result: { itemId } };
            },
            saveRecipient: async (record, character) => (await writeVersionedPlayerSave(recipientSaveKey, record, character)).record,
        });
        await kv.set(`${AUDIT_LOG_PREFIX}${village.toLowerCase()}:${Date.now()}`, {
            ts: Date.now(),
            actor: actorName ?? 'admin',
            village,
            recipientName,
            ...('currency' in transfer.result ? { currency: transfer.result.currency, amount: transfer.result.amount } : {}),
            ...('itemId' in transfer.result ? { itemId: transfer.result.itemId } : {}),
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        // Economy telemetry — the gift levy is currency DESTROYED, the same
        // signal as trade.burn. Without this the treasury channel moves volume
        // the faucet/sink ledger never sees, which is precisely the blind spot
        // the levy was added to close (api/_treasury-gift-tax.ts).
        if ('currency' in transfer.result && Number(transfer.result.burned) > 0) {
            await recordEconomyTxn({
                txnId: `village-treasury-gift-burn:${Date.now()}`,
                player: recipientName,
                currency: String(transfer.result.currency),
                delta: -Number(transfer.result.burned),
                source: 'village.gift.burn',
            });
        }
        return res.status(200).json({ ok: true, ...transfer.result });
    } catch (err) {
        if (err instanceof SettlementValidationError) {
            return res.status(err.status).json({ error: err.message });
        }
        console.error('[village/treasury-transfer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
