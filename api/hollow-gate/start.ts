import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { randomUUID } from 'node:crypto';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    rollAugmentOffers,
    augmentDisplay,
    HG_CLAWBACK_KEYS,
    HG_HIGH_VALUE_ITEM_ID,
    itemStackCount,
    canonicalHollowGateDepth,
    type HollowGateRunToken,
    type HgCurrencyKey,
} from './_run-token.js';
import { RIFT_QUESTS } from '../sector/_rift-quest.js';

/*
 * /api/hollow-gate/start  — POST only  (docs/hollow-gate-augments.md)
 *
 * Mints a server-sealed run token for a Hollow Gate dive: seals the entry
 * currency snapshot + dive depth, rolls 3 augment offers (the client can't pick
 * the pool), and increments a SERVER daily-run counter (independent of the
 * client's lastDailyReset — closes the backdated-reset extra-dive exploit, #7).
 * Settle later credits min(claimed, sealed ceiling). Body: { playerName, floorDepth }.
 *
 * Inert until the client run loop is wired to it (a later pass, flag-gated), so
 * the existing no-token client path keeps working (token-first invariant).
 */

const DEFAULT_DAILY_RUN_CAP = 2; // base 2/day; attunement raises it in the client-wiring pass
// Hollow Gate runs are RESUMABLE across sessions (the run persists on the save), so
// the token must outlive a dive the player walks away from and finishes later. 24h
// comfortably covers any same-day resume; a run older than that has already crossed
// the UTC daily-cap reset, and an expired token just reverts that run to the
// non-browser compatibility path; shipped browser gameplay requires this seal.
const RUN_TTL_SEC = 24 * 60 * 60;

function utcDateKey(): string { return new Date().toISOString().slice(0, 10); }

type PublishedEventGate = {
    id: string;
    floors: number;
    bossAiId?: string;
    bossName?: string;
    keyCost: 0 | 1;
    updatedAt: number;
};

export function normalizePublishedEventGate(raw: unknown, requestedId: string): PublishedEventGate | null {
    if (!raw || typeof raw !== 'object') return null;
    const config = raw as Record<string, unknown>;
    if (config.active !== true || String(config.id ?? '') !== requestedId) return null;
    const bossAiId = String(config.bossAiId ?? '').trim().slice(0, 128);
    const bossName = String(config.bossName ?? '').trim().slice(0, 64);
    return {
        id: requestedId,
        floors: canonicalHollowGateDepth(config.maxFloor),
        ...(bossAiId ? { bossAiId } : {}),
        ...(bossName ? { bossName } : {}),
        keyCost: Number(config.keyCost) === 0 ? 0 : 1,
        updatedAt: Math.max(0, Number(config.updatedAt) || 0),
    };
}

async function readPublishedEventGate(requestedId: string): Promise<PublishedEventGate | null> {
    if (!requestedId || requestedId.startsWith('rift-')) return null;
    const saves = await Promise.all([
        kv.get<Record<string, unknown>>('save:admin1'),
        kv.get<Record<string, unknown>>('save:admin2'),
    ]);
    const latest = saves
        .map((save) => save?.hollowGateEventConfig)
        .filter((raw): raw is Record<string, unknown> => Boolean(raw && typeof raw === 'object'))
        .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0];
    return normalizePublishedEventGate(latest, requestedId);
}

export function consumeHollowGateKey(character: Record<string, unknown>): Record<string, unknown> | null {
    const itemId = 'hollow-gate-key';
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks as Array<Record<string, unknown>> : [];
    let removed = false;
    const nextStacks = stacks.map((stack) => {
        if (removed || String(stack?.itemId ?? '') !== itemId || Number(stack?.count) <= 0) return stack;
        removed = true;
        return { ...stack, count: Math.max(0, Math.floor(Number(stack.count) || 0) - 1) };
    }).filter((stack) => Number(stack?.count) > 0);
    if (removed) return { ...character, itemStacks: nextStacks };
    const inventory = Array.isArray(character.inventory) ? character.inventory as string[] : [];
    const index = inventory.indexOf(itemId);
    if (index < 0) return null;
    return { ...character, inventory: inventory.filter((_, i) => i !== index) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const requestedVariantId = String(body.variantId ?? '').slice(0, 64);
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only start your own dive.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-start', 20, 60_000, identity.name))) return;

        const sealedRift = requestedVariantId.startsWith('rift-')
            ? await kv.get<{ id?: string }>(`rift-quest:${playerName}`)
            : null;
        const riftDef = sealedRift?.id === requestedVariantId ? RIFT_QUESTS[requestedVariantId] : undefined;
        const eventDef = await readPublishedEventGate(requestedVariantId);
        // Only server-owned Rift quests and the current admin-published event
        // may shorten a dive. Arbitrary client floorDepth input is ignored.
        const floorDepth = riftDef?.floors ?? eventDef?.floors ?? canonicalHollowGateDepth();

        let issued: { token: string; runToken: HollowGateRunToken; offers: ReturnType<typeof rollAugmentOffers> } | null = null;
        const mutation = await mutatePlayerSave(playerName, async ({ character }) => {
            const freeEntry = Boolean(riftDef) || eventDef?.keyCost === 0;
            const afterKey = identity.admin || freeEntry ? character : consumeHollowGateKey(character);
            if (!afterKey) return { ok: false as const, status: 409, error: 'hollow-gate-key-required' };
            const cap = DEFAULT_DAILY_RUN_CAP + Math.max(0, Math.floor(Number(character.hollowGateRunBonus ?? 0)));
            const countKey = `hg-runs:${playerName}:${utcDateKey()}`;
            const priorRuns = Math.max(0, Math.floor(Number(await kv.get<number>(countKey)) || 0));
            if (!identity.admin && priorRuns >= cap) return { ok: false as const, status: 429, error: 'daily-cap' };
            const ord = await kv.incr(countKey, { ex: 25 * 60 * 60 });
            const entry = {} as Partial<Record<HgCurrencyKey, number>>;
            for (const k of HG_CLAWBACK_KEYS) entry[k] = Math.max(0, Math.floor(Number(character[k]) || 0));
            const offers = rollAugmentOffers(3);
            const token = randomUUID().replace(/-/g, '');
            const runToken: HollowGateRunToken = {
                playerName, mintedAt: Date.now(), floorDepth, seed: randomUUID(),
                entryCurrencies: entry,
                entryFragments: itemStackCount(character.itemStacks, HG_HIGH_VALUE_ITEM_ID),
                offeredAugmentIds: offers.map((o) => o.id), chosenAugmentId: null,
                dailyRunOrdinal: ord,
                ...(riftDef ? {
                    variantId: riftDef.id,
                    bossProfileId: riftDef.bossAiId,
                    bossName: riftDef.bossName,
                } : eventDef ? {
                    variantId: eventDef.id,
                    ...(eventDef.bossAiId ? { bossProfileId: eventDef.bossAiId } : {}),
                    ...(eventDef.bossName ? { bossName: eventDef.bossName } : {}),
                } : {}),
            };
            issued = { token, runToken, offers };
            return {
                ok: true as const,
                character: {
                    ...afterKey,
                    dailyHollowGateRuns: ord,
                    lastDailyReset: utcDateKey(),
                },
                value: { token },
            };
        });
        if (!mutation.ok) {
            if (mutation.error === 'daily-cap') return res.status(200).json({ ok: true, reason: 'daily-cap', token: null });
            return res.status(mutation.status).json({ error: mutation.error });
        }
        if (!issued) return res.status(500).json({ error: 'Run token was not issued.' });
        const committed = issued as { token: string; runToken: HollowGateRunToken; offers: ReturnType<typeof rollAugmentOffers> };
        await kv.set(`hg-run:${playerName}:${committed.token}`, committed.runToken, { ex: RUN_TTL_SEC });
        return res.status(200).json({
            ok: true,
            token: committed.token,
            seed: committed.runToken.seed,
            augmentOffers: committed.offers.map(augmentDisplay),
            character: mutation.character,
            _saveVersion: mutation._saveVersion,
        });
    } catch (err) {
        console.error('[hollow-gate/start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
