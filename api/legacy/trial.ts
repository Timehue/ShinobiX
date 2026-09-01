import { randomUUID } from 'node:crypto';
import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { getLegacyStats, appendLegacyEvent, legacyEnabled } from '../_legacy-track.js';
import { LEGACY_JUTSU_CATALOG } from '../pvp/_legacy-jutsu-catalog.js';
import { LEGACY_BY_ID } from '../_legacy-defs.js';
import {
    legacyTrialKey, legacyAcceptedKey, trialObjectivesFor, trialProgress, nextTrialKind,
    provenTitleFor, mythicTitleFor, trialIntroFor, trialCompletionFor, TRIAL_VARIANT_COUNT,
    legacyTrialReceiptId,
    type LegacyTrial, type CharacterLegacy, type LegacyTrialCompletionReceipt,
} from '../_legacy-core.js';
import { announce, addHallEntry, postVillageHerald } from '../_announce.js';
import { recordAudit } from '../_audit.js';
import { bumpEraContributionOnce, recordEraTrigger } from '../_era.js';
import {
    grantChronicleProgressionCards,
    legacyProgressionCardId,
} from '../card-clash/_progression-cards.js';

/*
 * /api/legacy/trial — Legacy Trials, all four stages: 1→2 "Awaken", 2→3
 * "Bind" (adds a cross-category secondary), 3→4 "Prove" (adds a discipline
 * proof), 4→5 "Mythic" (the culmination — both).
 *
 * Trials are fresh-delta objectives over the SERVER-OWNED legacy counters
 * (api/_legacy-track.ts): the baseline is sealed at start, and completion is
 * `current - baseline >= delta` for every objective. Nothing here trusts the
 * client body beyond the action word; failing a trial never unlocks a
 * different legacy (design rule — retry the same path forever).
 *
 *   GET  ?playerName=        → { trial (with live progress), legacy, intro }
 *   POST { action:'start' }  → seal baselines for the next stage's trial
 *   POST { action:'reroll' } → swap to the alternate proof, FRESH baselines, attempt++
 *   POST { action:'complete' } → verify objectives; advance stage; grant title
 */

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const withTrialId = (trial: LegacyTrial): LegacyTrial => (
    trial.id ? trial : { ...trial, id: legacyTrialReceiptId(trial) }
);

// Announcement variety (depth-audit finding: one fixed template per event type
// made the 3rd mythic awakening read identically to the 1st). Message pools are
// picked at random and weave in the legacy's own flavor line, so every legacy
// announces in its own voice.
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const LEGENDARY_AWAKEN_MSGS: ReadonlyArray<(p: string, defName: string, title: string, flavor: string) => string> = [
    (p, _n, t, f) => `${p} has completed the Trial of the ${t}. ${f}`,
    (p, n, _t, f) => `The ${n} has awakened in ${p}'s hands. ${f}`,
    (p, _n, t, f) => `Word spreads from the trial grounds: ${p} now carries the name "${t}". ${f}`,
];
const MYTHIC_AWAKEN_MSGS: ReadonlyArray<(p: string, defName: string, flavor: string) => string> = [
    (p, n, _f) => `${p} has awakened the ${n}. The world will remember.`,
    (p, n, f) => `A storied path has opened its eyes: ${p} carries the ${n}. ${f}`,
    (p, n, _f) => `The taverns will argue about this for a generation — ${p} has awakened the ${n}.`,
];
const MYTHIC_BIND_MSGS: ReadonlyArray<(p: string, defName: string) => string> = [
    (p, n) => `${p} has bound the ${n} to their soul. Stage III — few will ever stand here.`,
    (p, n) => `The ${n} and ${p} can no longer be told apart. The Binding holds. Stage III.`,
];
const SUMMIT_MSGS: ReadonlyArray<(p: string, defName: string, mythicTitle: string) => string> = [
    (p, n, t) => `${p} has carried the ${n} to Stage V — Mythic. "${t}" now walks the world.`,
    (p, n, t) => `A path is complete: ${p} stands at the summit of the ${n}. History will use the name "${t}".`,
    (p, n, _t) => `The Hall of Legends has begun carving: the ${n} has reached its summit in ${p}'s hands.`,
];
// Local pride: posted only into the affinity village's chat when a favored
// Legacy awakens — a proud beat even for quiet basic/rare paths, so each
// village has a stake in the legacies it favors. `v` is the short affinity
// name ("Moonshadow"); the herald speaks to that village directly.
const AFFINITY_AWAKEN_MSGS: ReadonlyArray<(p: string, defName: string, v: string) => string> = [
    (p, n, v) => `${v} raises a cup: one of our own, ${p}, has awakened the ${n}. The village claims this path as ours.`,
    (p, n, v) => `A favored path returns to ${v} — ${p} has awakened the ${n}. Let the gate-fires burn a little higher tonight.`,
    (p, n, v) => `Word runs the ${v} streets: ${p} carries the ${n} now. This legacy has always belonged to us.`,
];
// Server-local mirror of lib/legacy-emissaries.ts category→emissary mapping (the
// client lib can't be imported from api/). Every LegacyCategory maps to exactly
// one of the eight trial-giver emissaries; used to voice the home-village herald
// in the keeper's own name. Data-dup, not an asset.
const EMISSARY_NAME_BY_CATEGORY: Record<string, string> = {
    ninjutsu: 'Storm-Caller Ryn', genjutsu: 'Veil-Mother Suzu', taijutsu: 'Iron Disciple Daigo',
    bukijutsu: 'Blade-Keeper Hana', pvp: 'Duel-Broker Kesshi', cards: 'Duel-Broker Kesshi', war: 'Duel-Broker Kesshi',
    pve: 'The Hollow Warden', mythic: 'The Hollow Warden', support: 'Lantern-Warden Mei', village: 'Lantern-Warden Mei',
    explorer: 'Mapless Ojii', pets: 'Mapless Ojii',
};

/** Server-first hall claim with a contention retry: addHallEntry returns null
 *  BOTH when the NX is already claimed and on transient lock contention — only
 *  the second case should retry, or a busy moment could permanently cost the
 *  true first player their once-ever entry (verification finding). */
async function claimServerFirst(
    entry: Parameters<typeof addHallEntry>[0],
    nxKey: string,
): Promise<Awaited<ReturnType<typeof addHallEntry>>> {
    let e = await addHallEntry(entry, { nxKey });
    if (!e) {
        const claimed = await kv.get<'1' | { status?: string }>(`hall:nx:${nxKey}`).catch(() => '1' as const);
        const done = claimed === '1' || claimed?.status === 'done';
        if (!done) e = await addHallEntry(entry, { nxKey });
    }
    return e;
}

const trialEffectsDoneKey = (player: string, receiptId: string) =>
    `legacy:trial-effects-done:${player}:${receiptId}`;

async function hallClaimDone(nxKey: string): Promise<boolean> {
    const marker = await kv.get<'1' | { status?: string }>(`hall:nx:${nxKey}`);
    return marker === '1' || marker?.status === 'done';
}

async function hallClaimPlayer(nxKey: string): Promise<string | null> {
    const marker = await kv.get<'1' | { status?: string; player?: string }>(`hall:nx:${nxKey}`);
    return marker && marker !== '1' && marker.status === 'done' && typeof marker.player === 'string'
        ? marker.player
        : null;
}

async function ensureHallEntry(
    entry: Parameters<typeof addHallEntry>[0],
    nxKey: string,
): Promise<boolean> {
    await addHallEntry(entry, { nxKey });
    return hallClaimDone(nxKey);
}

function trialReceiptResponse(
    receipt: LegacyTrialCompletionReceipt,
    character: Record<string, unknown>,
    record: Record<string, unknown>,
) {
    return {
        ok: true,
        legacy: character.legacy,
        title: receipt.title,
        completion: receipt.completion,
        chronicleCards: receipt.chronicleCards,
        ...(receipt.signatureJutsu ? { signatureJutsu: receipt.signatureJutsu } : {}),
        character,
        _saveVersion: Number(record._saveVersion) || 0,
        receiptId: receipt.id,
    };
}

/** Retry-safe world delivery. Every mutable destination receives a stable
 * receipt identity; the final marker is written only when all required effects
 * are durably present. A crash before that marker simply re-runs idempotent
 * ensures on the next completion replay. */
async function deliverTrialCompletionEffects(
    playerName: string,
    def: NonNullable<ReturnType<typeof LEGACY_BY_ID.get>>,
    receipt: LegacyTrialCompletionReceipt,
    character: Record<string, unknown>,
): Promise<boolean> {
    const doneKey = trialEffectsDoneKey(playerName, receipt.id);
    if (await kv.get(doneKey)) return true;
    const effectId = `legacy-trial:${playerName}:${receipt.id}`;
    const village = String(character.village ?? '') || undefined;

    if (!(await appendLegacyEvent(playerName, {
        type: 'trial-complete',
        key: `${receipt.legacyId}:${receipt.kind}`,
        receiptId: `${effectId}:event`,
    }))) return false;
    if (!(await recordAudit({
        receiptId: `${effectId}:audit`,
        actor: playerName,
        domain: 'legacy',
        action: `trial.${receipt.kind}.complete`,
        entityType: 'legacy',
        entityId: receipt.legacyId,
        meta: { stage: receipt.stage },
    }))) return false;

    if (receipt.kind === 'awaken') {
        if (!(await bumpEraContributionOnce('legaciesAwakened', `${effectId}:era`))) return false;
        if (def.rarity === 'mythic'
            && !(await recordEraTrigger('first-mythic-awakening', { player: playerName, village }))) return false;

        if (def.rarity === 'legendary') {
            if (!(await announce({
                type: 'legacy_awakening', importance: 'high',
                title: 'A LEGACY AWAKENS',
                message: pick(LEGENDARY_AWAKEN_MSGS)(playerName, def.name, def.title, def.flavor),
                player: playerName, village, legacyId: def.id,
            }, { receiptId: `${effectId}:announcement` }))) return false;
        } else if (def.rarity === 'mythic') {
            if (!(await announce({
                type: 'mythic_legacy', importance: 'mythic',
                title: 'A LEGACY AWAKENS',
                message: pick(MYTHIC_AWAKEN_MSGS)(playerName, def.name, def.flavor),
                player: playerName, village, legacyId: def.id,
            }, { receiptId: `${effectId}:announcement` }))) return false;
            const mythicKey = `mythic-legacy:${def.id}:${playerName}`;
            if (!(await ensureHallEntry({
                entryType: 'mythic_legacy',
                title: def.name,
                description: `Awakened by ${playerName}${village ? ` of ${village}` : ''}. ${def.flavor}`,
                player: playerName, village, legacyId: def.id,
            }, mythicKey))) return false;

            const firstKey = 'server-first:mythic-awakening';
            await claimServerFirst({
                entryType: 'server_first',
                title: 'First Great Legacy Awakening',
                description: `${playerName}${village ? ` of ${village}` : ''} was the first shinobi on the server to awaken one of the world's most storied paths — the ${def.name}.`,
                player: playerName, village, legacyId: def.id,
            }, firstKey);
            if (!(await hallClaimDone(firstKey))) return false;
            if ((await hallClaimPlayer(firstKey)) === playerName) {
                if (!(await announce({
                    type: 'server_first', importance: 'mythic',
                    title: 'SERVER FIRST — GREAT LEGACY AWAKENING',
                    message: `History: ${playerName} is the FIRST to awaken one of the world's most storied paths. The ${def.name} chose well.`,
                    player: playerName, village, legacyId: def.id,
                }, { receiptId: `${effectId}:server-first-announcement` }))) return false;
            }
        }

        if (def.villageAffinity && !(await postVillageHerald(
            `${def.villageAffinity} Village`,
            'A Favored Path Awakens',
            pick(AFFINITY_AWAKEN_MSGS)(playerName, def.name, def.villageAffinity),
            { receiptId: `${effectId}:affinity-herald` },
        ))) return false;
        if (village && (!def.villageAffinity || village !== `${def.villageAffinity} Village`)) {
            const keeper = EMISSARY_NAME_BY_CATEGORY[def.category];
            const homeMsg = keeper
                ? `${keeper} was seen at the ${village} gate: "One of yours, ${playerName}, has taken up the ${def.name}. Mark the day."`
                : `${village} marks the day: one of its own, ${playerName}, has taken up the ${def.name}.`;
            if (!(await postVillageHerald(
                village,
                'One of Ours Awakens',
                homeMsg,
                { receiptId: `${effectId}:home-herald` },
            ))) return false;
        }
    } else if (receipt.kind === 'bind' && def.rarity === 'mythic') {
        if (!(await announce({
            type: 'mythic_legacy', importance: 'high',
            title: 'A LEGACY IS BOUND',
            message: pick(MYTHIC_BIND_MSGS)(playerName, def.name),
            player: playerName, village, legacyId: def.id,
        }, { receiptId: `${effectId}:announcement` }))) return false;
    } else if (receipt.kind === 'mythic') {
        if (!(await announce({
            type: 'legacy_completion', importance: 'mythic',
            title: 'A LEGACY REACHES ITS SUMMIT',
            message: pick(SUMMIT_MSGS)(playerName, def.name, mythicTitleFor(def.title)),
            player: playerName, village, legacyId: def.id,
        }, { receiptId: `${effectId}:announcement` }))) return false;
        const summitKey = `legacy-summit:${def.id}:${playerName}`;
        if (!(await ensureHallEntry({
            entryType: 'legacy_summit',
            title: `${def.name} — Stage V`,
            description: `${playerName}${village ? ` of ${village}` : ''} carried this legacy to its summit. ${def.flavor}`,
            player: playerName, village, legacyId: def.id,
        }, summitKey))) return false;

        const firstKey = 'server-first:legacy-summit';
        await claimServerFirst({
            entryType: 'server_first',
            title: 'First Legacy Summit',
            description: `${playerName}${village ? ` of ${village}` : ''} was the first shinobi on the server to carry a legacy to Stage V — the ${def.name}.`,
            player: playerName, village, legacyId: def.id,
        }, firstKey);
        if (!(await hallClaimDone(firstKey))) return false;
        if ((await hallClaimPlayer(firstKey)) === playerName) {
            if (!(await announce({
                type: 'server_first', importance: 'mythic',
                title: 'SERVER FIRST — A LEGACY COMPLETED',
                message: `History: ${playerName} is the FIRST to carry a legacy to its summit. The ${def.name} stands complete.`,
                player: playerName, village, legacyId: def.id,
            }, { receiptId: `${effectId}:server-first-announcement` }))) return false;
        }
    }

    await kv.set(doneKey, { completedAt: Date.now() });
    return true;
}

export type LegacyTrialEffectsRepair = {
    attempted: number;
    repaired: number;
    effectsPending: boolean;
};

/**
 * Drain durable trial-completion receipts from an authoritative save.
 *
 * Completion deliberately commits the stage/title/Chronicle reward before its
 * social and world-history fan-out. A process failure after that commit can
 * therefore leave no active trial for the client to POST again. Authenticated
 * Legacy reads call this pump so an ordinary page reload finishes the outbox.
 *
 * Oldest-first ordering is load-bearing: if several stage receipts were left
 * pending during an outage, later ceremonies must not overtake earlier deeds.
 * The trial lock is fail-closed and every destination has its own stable
 * receipt, so concurrent GETs/workers cannot duplicate or misattribute effects.
 * This function never mutates the save and therefore never manufactures a save
 * version or asks the client to hydrate a routine GET snapshot.
 */
export async function repairPendingTrialCompletionEffects(
    playerName: string,
): Promise<LegacyTrialEffectsRepair> {
    return withKvLock(legacyTrialKey(playerName), async () => {
        const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = (rec?.character ?? null) as Record<string, unknown> | null;
        const legacy = (character?.legacy ?? null) as CharacterLegacy | null;
        const receipts = Array.isArray(legacy?.trialCompletionReceipts)
            ? [...legacy.trialCompletionReceipts]
            : [];
        if (!character || !legacy || receipts.length === 0) {
            return { attempted: 0, repaired: 0, effectsPending: false };
        }

        receipts.sort((a, b) => Number(a.completedAt) - Number(b.completedAt));
        let attempted = 0;
        let repaired = 0;
        let effectsPending = false;
        for (const receipt of receipts) {
            const receiptId = typeof receipt?.id === 'string' ? receipt.id.trim() : '';
            const def = LEGACY_BY_ID.get(receipt?.legacyId);
            // The save is server-owned, but corrupt historical evidence must
            // fail closed instead of announcing a deed for the wrong Legacy.
            if (!receiptId || receipt.legacyId !== legacy.legacyId || !def) {
                effectsPending = true;
                break;
            }
            if (await kv.get(trialEffectsDoneKey(playerName, receiptId))) continue;
            attempted += 1;
            if (!(await deliverTrialCompletionEffects(playerName, def, receipt, character))) {
                effectsPending = true;
                break;
            }
            repaired += 1;
        }
        return { attempted, repaired, effectsPending };
    }, { failClosed: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!legacyEnabled()) return res.status(404).json({ error: 'Legacies are not awake yet.' });

    try {
        const isGet = req.method === 'GET';
        const body = isGet ? {} : (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(isGet ? req.query.playerName ?? '' : body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }

        if (isGet) {
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'legacy-trial-get', 20, 60_000, identity.name))) return;
            const effectsRepair = await repairPendingTrialCompletionEffects(playerName);
            const [trial, rec] = await Promise.all([
                kv.get<LegacyTrial>(legacyTrialKey(playerName)),
                kv.get<Record<string, unknown>>(`save:${playerName}`),
            ]);
            const legacy = ((rec?.character as Record<string, unknown> | undefined)?.legacy ?? null) as CharacterLegacy | null;
            if (!trial) return res.status(200).json({
                trial: null,
                legacy,
                effectsPending: effectsRepair.effectsPending,
                effectsRepaired: effectsRepair.repaired > 0,
            });
            const stats = await getLegacyStats(playerName);
            const defForIntro = LEGACY_BY_ID.get(trial.legacyId);
            return res.status(200).json({
                trial: { ...withTrialId(trial), objectives: trialProgress(trial, stats) },
                legacy,
                intro: defForIntro ? trialIntroFor(defForIntro, trial.kind) : null,
                effectsPending: effectsRepair.effectsPending,
                effectsRepaired: effectsRepair.repaired > 0,
            });
        }

        if (req.method !== 'POST') return res.status(405).end();
        const action = typeof body.action === 'string' ? body.action : '';
        if (!identity.admin && !(await enforceRateLimitKv(req, res, `legacy-trial-${action}`, 10, 60_000, identity.name))) return;

        // ── START: seal baselines for the next stage's trial ────────────────
        if (action === 'start') {
            const out = await withKvLock<{ status: number; body: unknown }>(legacyTrialKey(playerName), async () => {
                const sealed = await kv.get<{ legacyId: string }>(legacyAcceptedKey(playerName));
                const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                const legacy = (char?.legacy ?? null) as CharacterLegacy | null;
                if (!sealed || !legacy || legacy.legacyId !== sealed.legacyId) {
                    return { status: 200, body: { ok: false, reason: 'no-legacy' } };
                }
                const def = LEGACY_BY_ID.get(legacy.legacyId);
                const kind = nextTrialKind(legacy.stage);
                if (!def || !kind) return { status: 200, body: { ok: false, reason: 'complete' } };

                // A live trial that still matches the current stage is 'busy';
                // one left behind by a stage move or an admin correction is
                // STALE and gets replaced, not honored — otherwise a failed
                // post-completion delete bricks progression forever
                // (verification finding).
                const existing = await kv.get<LegacyTrial>(legacyTrialKey(playerName));
                if (existing && existing.legacyId === legacy.legacyId && existing.kind === kind) {
                    return { status: 200, body: { ok: false, reason: 'busy' } };
                }

                const stats = await getLegacyStats(playerName, char);
                const objectives = trialObjectivesFor(def, kind);
                const trial: LegacyTrial = {
                    id: randomUUID(),
                    legacyId: legacy.legacyId, kind, startedAt: Date.now(), attempt: 1, variant: 0,
                    baselines: Object.fromEntries(objectives.map((o) => [o.stat, num(stats[o.stat])])),
                    objectives,
                };
                await kv.set(legacyTrialKey(playerName), trial);
                await appendLegacyEvent(playerName, { type: 'trial-started', key: `${legacy.legacyId}:${kind}` });
                // Decorated objectives ({progress, done}) like every read path —
                // clients render trial.objectives directly (verification finding:
                // raw {stat, delta} pairs crashed the emissary panel).
                return {
                    status: 200,
                    body: { ok: true, trial: { ...trial, objectives: trialProgress(trial, stats) }, intro: trialIntroFor(def, kind) },
                };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        // ── REROLL: same stage, different proof ──────────────────────────────
        // The Sage's "trials may be retried" made real: swap to the next primary
        // variant with FRESH baselines (attempt++). Never a shortcut — progress
        // resets, only the shape of the ask changes. Objectives are re-derived
        // server-side; nothing in the body is trusted.
        if (action === 'reroll') {
            const out = await withKvLock<{ status: number; body: unknown }>(legacyTrialKey(playerName), async () => {
                const existing = await kv.get<LegacyTrial>(legacyTrialKey(playerName));
                if (!existing) return { status: 200, body: { ok: false, reason: 'none' } };
                const def = LEGACY_BY_ID.get(existing.legacyId);
                if (!def) return { status: 200, body: { ok: false, reason: 'none' } };

                const stats = await getLegacyStats(playerName);
                const variant = ((existing.variant ?? 0) + 1) % TRIAL_VARIANT_COUNT;
                const objectives = trialObjectivesFor(def, existing.kind, variant);
                const trial: LegacyTrial = {
                    id: randomUUID(),
                    legacyId: existing.legacyId, kind: existing.kind, startedAt: Date.now(),
                    attempt: (num(existing.attempt) || 1) + 1, variant,
                    baselines: Object.fromEntries(objectives.map((o) => [o.stat, num(stats[o.stat])])),
                    objectives,
                };
                await kv.set(legacyTrialKey(playerName), trial);
                await appendLegacyEvent(playerName, { type: 'trial-reroll', key: `${existing.legacyId}:${existing.kind}:${variant}` });
                return {
                    status: 200,
                    body: { ok: true, trial: { ...trial, objectives: trialProgress(trial, stats) }, intro: trialIntroFor(def, existing.kind) },
                };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        // ── COMPLETE: verify deltas, advance stage, grant title ─────────────
        if (action === 'complete') {
            const requestedReceiptId = typeof body.trialId === 'string'
                ? body.trialId.trim().slice(0, 200)
                : '';
            const out = await withKvLock<{ status: number; body: unknown }>(legacyTrialKey(playerName), async () => {
                const activeRaw = await kv.get<LegacyTrial>(legacyTrialKey(playerName));

                // The active trial is removed only after its in-save receipt
                // commits. A retry after deletion/lost response resolves that
                // durable receipt and re-drives any unfinished world effects.
                if (!activeRaw) {
                    const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const character = (rec?.character ?? null) as Record<string, unknown> | null;
                    const legacy = (character?.legacy ?? null) as CharacterLegacy | null;
                    const receipts = legacy?.trialCompletionReceipts ?? [];
                    const receipt = requestedReceiptId
                        ? receipts.find((item) => item.id === requestedReceiptId) ?? null
                        : receipts[0] ?? null;
                    if (!rec || !character || !receipt) {
                        return { status: 200, body: { ok: false, reason: 'none' } };
                    }
                    const def = LEGACY_BY_ID.get(receipt.legacyId);
                    if (!def) return { status: 200, body: { ok: false, reason: 'none' } };
                    if (!(await deliverTrialCompletionEffects(playerName, def, receipt, character))) {
                        return {
                            status: 503,
                            body: { error: 'Trial committed; Chronicle delivery is retrying.', retryable: true, receiptId: receipt.id },
                        };
                    }
                    return { status: 200, body: trialReceiptResponse(receipt, character, rec) };
                }

                const trial = withTrialId(activeRaw);
                const receiptId = legacyTrialReceiptId(trial);
                if (requestedReceiptId && requestedReceiptId !== receiptId) {
                    return { status: 409, body: { ok: false, reason: 'stale-trial', trialId: receiptId } };
                }
                const def = LEGACY_BY_ID.get(trial.legacyId);
                if (!def) return { status: 200, body: { ok: false, reason: 'none' } };

                // If a previous attempt committed the receipt but died before
                // deleting the active trial, replay it without re-validating or
                // re-applying the stage transition.
                const before = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const beforeCharacter = (before?.character ?? null) as Record<string, unknown> | null;
                const beforeLegacy = (beforeCharacter?.legacy ?? null) as CharacterLegacy | null;
                const committed = beforeLegacy?.trialCompletionReceipts?.find((item) => item.id === receiptId) ?? null;
                if (before && beforeCharacter && committed) {
                    await kv.del(legacyTrialKey(playerName));
                    if (!(await deliverTrialCompletionEffects(playerName, def, committed, beforeCharacter))) {
                        return {
                            status: 503,
                            body: { error: 'Trial committed; Chronicle delivery is retrying.', retryable: true, receiptId },
                        };
                    }
                    return { status: 200, body: trialReceiptResponse(committed, beforeCharacter, before) };
                }

                const stats = await getLegacyStats(playerName);
                const progress = trialProgress(trial, stats);
                if (!progress.every((p) => p.done)) {
                    return { status: 200, body: { ok: false, reason: 'incomplete', objectives: progress } };
                }

                const now = Date.now();
                const grantedTitle = trial.kind === 'awaken' ? def.title
                    : trial.kind === 'prove' ? provenTitleFor(def.title)
                    : trial.kind === 'mythic' ? mythicTitleFor(def.title)
                    : null;
                const signatureName = trial.kind === 'bind' && def.specialtyJutsuId
                    ? LEGACY_JUTSU_CATALOG[def.specialtyJutsuId]?.name ?? null
                    : null;
                const completion = signatureName
                    ? `${trialCompletionFor(trial.kind)} The path presses its technique into your hands — ${signatureName} is yours now, a signature only your Legacy can wield.`
                    : trialCompletionFor(trial.kind);

                type SaveCompletion =
                    | { status: 'missing' }
                    | { status: 'stale' }
                    | {
                        status: 'ok';
                        record: Record<string, unknown>;
                        character: Record<string, unknown>;
                        receipt: LegacyTrialCompletionReceipt;
                    };
                const saveOut = await withKvLock<SaveCompletion>(`save:${playerName}`, async () => {
                    const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const char = (rec?.character ?? null) as Record<string, unknown> | null;
                    const legacy = (char?.legacy ?? null) as CharacterLegacy | null;
                    if (!rec || !char || !legacy || legacy.legacyId !== trial.legacyId) return { status: 'missing' };
                    const prior = legacy.trialCompletionReceipts?.find((item) => item.id === receiptId);
                    if (prior) return { status: 'ok', record: rec, character: char, receipt: prior };

                    const next: CharacterLegacy = { ...legacy };
                    let targetStage: 2 | 3 | 4 | 5;
                    let reachedAt = now;
                    if (trial.kind === 'awaken') {
                        targetStage = 2;
                        if (legacy.stage === 1) next.awakenedAt = now;
                        else if (legacy.stage === 2 && legacy.awakenedAt) reachedAt = legacy.awakenedAt;
                        else return { status: 'stale' };
                    } else if (trial.kind === 'bind') {
                        targetStage = 3;
                        if (legacy.stage === 2) next.boundAt = now;
                        else if (legacy.stage === 3 && legacy.boundAt) reachedAt = legacy.boundAt;
                        else return { status: 'stale' };
                    } else if (trial.kind === 'prove') {
                        targetStage = 4;
                        if (legacy.stage === 3) next.provenAt = now;
                        else if (legacy.stage === 4 && legacy.provenAt) reachedAt = legacy.provenAt;
                        else return { status: 'stale' };
                    } else {
                        targetStage = 5;
                        if (legacy.stage === 4) next.mythicAt = now;
                        else if (legacy.stage === 5 && legacy.mythicAt) reachedAt = legacy.mythicAt;
                        else return { status: 'stale' };
                    }
                    next.stage = targetStage;
                    if (grantedTitle) next.titles = [...new Set([...(legacy.titles ?? []), grantedTitle])];
                    const earned = Array.isArray(char.earnedTitles) ? (char.earnedTitles as string[]) : [];
                    const updated = {
                        ...char,
                        legacy: next,
                        earnedTitles: grantedTitle ? [...new Set([...earned, grantedTitle])] : earned,
                    };
                    const legacyCardId = trial.kind === 'awaken' ? legacyProgressionCardId(trial.legacyId) : null;
                    const chronicle = char.starterCardsClaimed === true && legacyCardId
                        ? grantChronicleProgressionCards(updated, [legacyCardId])
                        : { character: updated, granted: [] as string[] };
                    const receipt: LegacyTrialCompletionReceipt = {
                        id: receiptId,
                        legacyId: trial.legacyId,
                        kind: trial.kind,
                        trialStartedAt: trial.startedAt,
                        attempt: trial.attempt,
                        completedAt: reachedAt,
                        stage: targetStage,
                        title: grantedTitle,
                        completion,
                        chronicleCards: chronicle.granted,
                        ...(signatureName && def.specialtyJutsuId
                            ? { signatureJutsu: { id: def.specialtyJutsuId, name: signatureName } }
                            : {}),
                    };
                    const withReceipt: CharacterLegacy = {
                        ...next,
                        trialCompletionReceipts: [
                            receipt,
                            ...(legacy.trialCompletionReceipts ?? []).filter((item) => item.id !== receipt.id),
                        ].slice(0, 4),
                    };
                    const character = { ...chronicle.character, legacy: withReceipt };
                    const written = mergePreservingImages(
                        bumpSaveVersion({ ...rec, character }),
                        rec,
                    ) as Record<string, unknown>;
                    await kv.set(`save:${playerName}`, written);
                    return { status: 'ok', record: written, character, receipt };
                }, { failClosed: true });

                if (saveOut.status === 'missing') {
                    return { status: 404, body: { error: 'Save not found.' } };
                }
                if (saveOut.status === 'stale') {
                    await kv.del(legacyTrialKey(playerName));
                    return { status: 200, body: { ok: false, reason: 'stale-cleared' } };
                }

                // The active proof is consumed only after the save contains the
                // exact response/outbox receipt. Any deletion error leaves it
                // available for the committed-receipt replay branch above.
                await kv.del(legacyTrialKey(playerName));
                if (!(await deliverTrialCompletionEffects(playerName, def, saveOut.receipt, saveOut.character))) {
                    return {
                        status: 503,
                        body: { error: 'Trial committed; Chronicle delivery is retrying.', retryable: true, receiptId },
                    };
                }
                return { status: 200, body: trialReceiptResponse(saveOut.receipt, saveOut.character, saveOut.record) };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Trial busy — please retry.' });
        }
        console.error('[legacy/trial]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
