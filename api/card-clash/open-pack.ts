import { safeLogValue } from '../_safe-log.js';
import { recordBetaMetric, betaRareGrantTally } from '../_beta-metrics.js';
import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { appendSettlementReceipt, inspectSettlementReceipt, parseSettlementRequestId } from '../_settlement-receipts.js';
import { recordEconomyTxn } from '../_economy.js';
import {
    applyCardPackOpen, parseCardPackType,
    type CardDuplicateConversion, type CardDuplicateRefund, type CardPackCurrency,
} from './_pack.js';
import { chronicleUnlocked, CHRONICLE_LOCKED_ERROR } from './_starter-cards.js';
import { BUILTIN_CLASH } from '../clan/war/_card-catalog.js';

type PackSettlement = {
    cards: string[]; currency: CardPackCurrency; cost: number; balance: number;
    converted: CardDuplicateConversion[]; refund: CardDuplicateRefund; replayed?: boolean;
};

const wholeAmount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

/** The duplicate conversions a stored receipt recorded. A receipt written
 *  before conversions shipped has none and replays as no conversion; anything
 *  else that does not describe the receipt's own draw is refused (null). */
function storedConversions(raw: unknown, cards: readonly string[]): { converted: CardDuplicateConversion[]; refund: CardDuplicateRefund } | null {
    if (raw === undefined) return { converted: [], refund: { chroniclePoints: 0, fateShards: 0 } };
    if (!Array.isArray(raw)) return null;
    const converted: CardDuplicateConversion[] = [];
    const refund: CardDuplicateRefund = { chroniclePoints: 0, fateShards: 0 };
    const seen = new Set<number>();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') return null;
        const { index, cardId, chroniclePoints, fateShards } = entry as Record<string, unknown>;
        if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= cards.length || seen.has(Number(index))) return null;
        if (typeof cardId !== 'string' || cardId !== cards[Number(index)]) return null;
        if (!wholeAmount(chroniclePoints) || !wholeAmount(fateShards)) return null;
        seen.add(Number(index));
        converted.push({ index: Number(index), cardId, chroniclePoints, fateShards });
        refund.chroniclePoints += chroniclePoints;
        refund.fateShards += fateShards;
    }
    return { converted, refund };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const packType = parseCardPackType(body.packType);
        const requestId = parseSettlementRequestId(body.requestId);
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!packType) return res.status(400).json({ error: 'Invalid card pack.' });
        // As with bank transfers, no ID retains old-client purchase behavior.
        if (body.requestId !== undefined && body.requestId !== null && !requestId) {
            return res.status(400).json({ error: 'Invalid requestId.' });
        }
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only open your own card packs.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'card-pack', 20, 60_000, identity.name))) return;

        const result = await mutatePlayerSave<PackSettlement>(playerName, ({ character }) => {
            const fingerprint = `chronicle-card-pack:${packType}`;
            const inspected = requestId ? inspectSettlementReceipt(character, requestId, fingerprint) : null;
            if (inspected?.status === 'conflict') {
                return { ok: false as const, status: 409, error: 'That request id was already used for a different purchase.' };
            }
            if (inspected?.status === 'invalid') {
                return { ok: false as const, status: 409, error: 'Stored settlement receipts are invalid. Contact support.' };
            }
            if (inspected?.status === 'replay') {
                const value = inspected.receipt.value;
                if (value.kind !== 'chronicle-card-pack' || value.packType !== packType
                    || !Array.isArray(value.cards) || value.cards.length === 0 || !value.cards.every((card) => typeof card === 'string')
                    || !['chroniclePoints', 'fateShards', 'ryo'].includes(String(value.currency))
                    || !Number.isSafeInteger(value.cost) || Number(value.cost) < 0
                    || !Number.isSafeInteger(value.balance) || Number(value.balance) < 0) {
                    return { ok: false as const, status: 409, error: 'Stored card pack receipt is invalid. Contact support.' };
                }
                const conversions = storedConversions(value.converted, value.cards as string[]);
                if (!conversions) {
                    return { ok: false as const, status: 409, error: 'Stored card pack receipt is invalid. Contact support.' };
                }
                // The receipt retains the original draw, while the response's
                // character/version describes today's save, even after other purchases.
                return {
                    ok: true as const, character, write: false,
                    value: { cards: value.cards as string[], currency: value.currency as CardPackCurrency,
                        cost: Number(value.cost), balance: Number(value.balance), ...conversions, replayed: true },
                };
            }
            // No codex, no packs — the scribe event unlocks the Chronicle.
            if (!identity.admin && !chronicleUnlocked(character)) {
                return { ok: false as const, status: 409, error: CHRONICLE_LOCKED_ERROR };
            }
            const opened = applyCardPackOpen(character, packType, randomInt);
            if (!opened.ok) return opened;
            const value = {
                cards: opened.cards, currency: opened.currency, cost: opened.cost, balance: opened.balance,
                converted: opened.converted, refund: opened.refund,
            };
            return {
                ok: true as const,
                // Cards, debit and retry proof are one existing versioned save write.
                character: requestId && inspected?.status === 'fresh'
                    ? appendSettlementReceipt(opened.character, inspected.receipts, {
                        requestId, fingerprint, value: { kind: 'chronicle-card-pack', packType, ...value }, settledAt: Date.now(),
                    })
                    : opened.character,
                value,
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        if (!result.value.replayed) {
            // Economy telemetry (I-19), after the commit and only for a fresh
            // open: the pack spend, then each currency the duplicate rebate paid.
            const txnBase = `card-pack:${playerName}:${requestId ?? `${Date.now()}-${randomInt(1_000_000_000)}`}`;
            void recordEconomyTxn({
                txnId: txnBase, player: playerName, currency: result.value.currency, delta: -result.value.cost,
                source: 'cardpack.open', balanceAfter: Number(result.character[result.value.currency] ?? 0),
            });
            for (const [currency, suffix] of [['chroniclePoints', 'cp'], ['fateShards', 'fs']] as const) {
                const rebate = result.value.refund[currency];
                if (rebate > 0) void recordEconomyTxn({
                    txnId: `${txnBase}:${suffix}`, player: playerName, currency, delta: rebate,
                    source: 'cardpack.duplicate', balanceAfter: Number(result.character[currency] ?? 0),
                });
            }
        }
        // Scarcity signal: how often a pack actually yields a scarce card. The
        // pack type is the source so the tally can be read per tier, and the
        // tally itself drops ordinary rarities. Fire-and-forget — a metrics
        // outage must not fail an opened pack the save has already recorded.
        const openedCards = Array.isArray(result.value?.cards) ? result.value.cards : [];
        if (!result.value.replayed) void recordBetaMetric({
            event: 'card.pack_opened',
            playerName,
            source: String(body.packType ?? 'unknown'),
            itemCount: openedCards.length,
            rareGrants: betaRareGrantTally('card', openedCards.map((id) => BUILTIN_CLASH[id]?.rarity)),
        });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (err) {
        console.error('[card-clash/open-pack]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
