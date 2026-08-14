import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { mergePreservingImages } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { appendLegacyEvent, getLegacyStats } from '../_legacy-track.js';
import { currentEraNumber } from '../_era.js';
import {
    grantChronicleProgressionCards,
    SAGE_PROGRESSION_CARD_ID,
} from '../card-clash/_progression-cards.js';
import { LEGACY_BY_ID, type LegacyDef } from '../_legacy-defs.js';
import {
    legacyAcceptedKey,
    legacyTrialKey,
    nextTrialKind,
    trialObjectivesFor,
    type CharacterLegacy,
    type LegacyAcceptanceReceipt,
    type LegacyTrial,
} from '../_legacy-core.js';
import { recordAudit } from '../_audit.js';
import { addHallEntry, announce } from '../_announce.js';

const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const OFFER_TTL_SECONDS = 7 * 24 * 60 * 60;

export const AURA_STONES_BY_RARITY: Readonly<Record<string, number>> = {
    mythic: 10,
    legendary: 8,
    rare: 5,
    basic: 3,
};

const retiredAuraGrantKey = (playerName: string) => `legacy:aura-granted:${playerName}`;
const acceptanceEffectsDoneKey = (playerName: string, receiptId: string) =>
    `legacy:accept-effects-done:${playerName}:${receiptId}`;

export type LegacyAcceptanceMarker = {
    legacyId: string;
    ts?: number;
    eraBorn?: number;
    actor?: string;
};

export type AcceptanceSaveResult =
    | { status: 'missing' }
    | { status: 'conflict' }
    | {
        status: 'ok';
        record: Record<string, unknown>;
        character: Record<string, unknown>;
        legacy: CharacterLegacy;
        receipt: LegacyAcceptanceReceipt;
        changed: boolean;
    };

export type AcceptanceTrialResult = {
    trial: LegacyTrial | null;
    stats: Awaited<ReturnType<typeof getLegacyStats>>;
    created: boolean;
};

export type LegacyAcceptanceRecovery =
    | { status: 'none' }
    | { status: 'missing' }
    | { status: 'invalid-marker'; legacyId: string }
    | { status: 'conflict'; legacyId: string }
    | {
        status: 'ok';
        def: LegacyDef;
        record: Record<string, unknown>;
        character: Record<string, unknown>;
        legacy: CharacterLegacy;
        receipt: LegacyAcceptanceReceipt;
        trial: LegacyTrial | null;
        stats: Awaited<ReturnType<typeof getLegacyStats>>;
        repaired: boolean;
        effectsPending: boolean;
    };

/**
 * Commit the Legacy, Aura Stone entitlement, Chronicle card, and their receipt
 * in one versioned save write. The receipt is the exact-once authority: retries
 * can safely finish a marker-only acceptance without pre-writing a payout key.
 */
export async function commitLegacyAcceptance(
    playerName: string,
    seed: CharacterLegacy,
    auraReward: number,
    now: number,
): Promise<AcceptanceSaveResult> {
    return withKvLock<AcceptanceSaveResult>(`save:${playerName}`, async () => {
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = (record?.character ?? null) as Record<string, unknown> | null;
        if (!record || !character) return { status: 'missing' };

        const current = (character.legacy ?? null) as CharacterLegacy | null;
        if (current && current.legacyId !== seed.legacyId) return { status: 'conflict' };
        const established = current?.legacyId === seed.legacyId;
        const baseLegacy: CharacterLegacy = established ? { ...current } : seed;
        const priorReceipt = baseLegacy.acceptanceReceipt?.legacyId === seed.legacyId
            ? baseLegacy.acceptanceReceipt
            : null;

        // Migration only: old builds wrote this marker before/alongside the
        // save. It suppresses a duplicate payout only when the save already
        // carries the Legacy. A marker-only stranded accept must still be paid.
        const oldPayoutMarker = priorReceipt || !established
            ? null
            : await kv.get(retiredAuraGrantKey(playerName));
        const shouldPayAura = !priorReceipt && (!established || !oldPayoutMarker);
        const updated: Record<string, unknown> = {
            ...character,
            legacy: baseLegacy,
            ...(shouldPayAura && auraReward > 0
                ? { auraStones: num(character.auraStones) + auraReward }
                : {}),
        };
        const chronicle = character.starterCardsClaimed === true
            ? grantChronicleProgressionCards(updated, [SAGE_PROGRESSION_CARD_ID])
            : { character: updated, granted: [] as string[] };
        const priorCards = Array.isArray(priorReceipt?.chronicleCards)
            ? priorReceipt.chronicleCards
            : [];
        const receiptCards = [...new Set([...priorCards, ...chronicle.granted])];
        const receipt: LegacyAcceptanceReceipt = priorReceipt
            ? { ...priorReceipt, chronicleCards: receiptCards }
            : {
                id: `legacy-accept:${playerName}:${seed.legacyId}`,
                legacyId: seed.legacyId,
                committedAt: now,
                auraStones: auraReward,
                chronicleCards: receiptCards,
            };
        const finalLegacy: CharacterLegacy = { ...baseLegacy, acceptanceReceipt: receipt };
        const finalCharacter = { ...chronicle.character, legacy: finalLegacy };
        const changed = !established
            || !priorReceipt
            || shouldPayAura
            || chronicle.granted.length > 0
            || receiptCards.length !== priorCards.length;
        if (!changed) {
            return {
                status: 'ok',
                record,
                character,
                legacy: baseLegacy,
                receipt,
                changed: false,
            };
        }

        const written = mergePreservingImages(
            bumpSaveVersion({ ...record, character: finalCharacter }),
            record,
        ) as Record<string, unknown>;
        await kv.set(`save:${playerName}`, written);
        return {
            status: 'ok',
            record: written,
            character: finalCharacter,
            legacy: finalLegacy,
            receipt,
            changed: true,
        };
    }, { failClosed: true });
}

/** Create the initial trial under the same lock used by trial start/reroll. */
export async function ensureAcceptanceTrial(
    playerName: string,
    def: LegacyDef,
    legacy: CharacterLegacy,
    character: Record<string, unknown>,
    now: number,
): Promise<AcceptanceTrialResult> {
    const stats = await getLegacyStats(playerName, character);
    return withKvLock<AcceptanceTrialResult>(legacyTrialKey(playerName), async () => {
        let trial = await kv.get<LegacyTrial>(legacyTrialKey(playerName));
        if (legacy.stage !== 1) return { trial, stats, created: false };
        const kind = nextTrialKind(1)!;
        if (trial && trial.legacyId === legacy.legacyId && trial.kind === kind) {
            return { trial, stats, created: false };
        }
        const objectives = trialObjectivesFor(def, kind);
        trial = {
            id: randomUUID(),
            legacyId: legacy.legacyId,
            kind,
            startedAt: now,
            attempt: 1,
            variant: 0,
            baselines: Object.fromEntries(objectives.map((objective) => [
                objective.stat,
                num(stats[objective.stat]),
            ])),
            objectives,
        };
        await kv.set(legacyTrialKey(playerName), trial);
        return { trial, stats, created: true };
    }, { failClosed: true });
}

async function hallAcceptanceClaimDone(playerName: string, legacyId: string): Promise<boolean> {
    const marker = await kv.get<'1' | { status?: string }>(
        `hall:nx:mythic-claim:${legacyId}:${playerName}`,
    );
    return marker === '1' || marker?.status === 'done';
}

/**
 * Durable, retry-safe fan-out for the acceptance event. Each destination uses
 * the stable in-save receipt id; the done marker lands only after every
 * required record can be observed. A later GET can therefore resume a partial
 * delivery without duplicating events, audits, announcements, or Hall entries.
 */
export async function deliverLegacyAcceptanceEffects(
    playerName: string,
    actor: string,
    def: LegacyDef,
    receipt: LegacyAcceptanceReceipt,
): Promise<boolean> {
    const doneKey = acceptanceEffectsDoneKey(playerName, receipt.id);
    try {
        if (await kv.get(doneKey)) return true;
        if (!(await appendLegacyEvent(playerName, {
            type: 'offer-accepted',
            key: def.id,
            receiptId: `${receipt.id}:event`,
        }))) return false;
        if (!(await recordAudit({
            receiptId: `${receipt.id}:audit`,
            actor,
            domain: 'legacy',
            action: 'legacy.accept',
            entityType: 'legacy',
            entityId: def.id,
            meta: { rarity: def.rarity },
        }))) return false;

        if (def.rarity === 'mythic') {
            if (!(await announce({
                type: 'mythic_legacy',
                importance: 'mythic',
                title: 'MYTHIC LEGACY CLAIMED',
                message: `${playerName} accepted the ${def.name}. From this moment, their path is sealed forever.`,
                player: playerName,
                legacyId: def.id,
            }, { receiptId: `${receipt.id}:announcement` }))) return false;
            await addHallEntry({
                entryType: 'mythic_legacy_claim',
                title: `${def.name} — Claimed`,
                description: `${playerName} accepted the ${def.name}. Their path is sealed forever.`,
                player: playerName,
                legacyId: def.id,
                rarity: def.rarity,
            }, { nxKey: `mythic-claim:${def.id}:${playerName}` });
            if (!(await hallAcceptanceClaimDone(playerName, def.id))) return false;
        }

        await kv.set(doneKey, { completedAt: Date.now(), receiptId: receipt.id });
        return true;
    } catch (error) {
        console.error(
            `[legacy/acceptance] effect delivery pending for ${playerName}:`,
            error instanceof Error ? error.message : error,
        );
        return false;
    }
}

/**
 * Finish a marker-only or partially delivered acceptance. This is intentionally
 * callable from ordinary authenticated reads: the permanent marker cannot
 * strand a player merely because the original offer expired or its response
 * was lost.
 */
export async function recoverLegacyAcceptance(
    playerName: string,
    fallbackActor = playerName,
): Promise<LegacyAcceptanceRecovery> {
    // Avoid taking a distributed transaction lock for the overwhelming
    // majority of pre-Legacy players. The second read inside the lock remains
    // authoritative and closes races for every observed marker.
    if (!(await kv.get<LegacyAcceptanceMarker>(legacyAcceptedKey(playerName)))) {
        return { status: 'none' };
    }
    return withKvLock<LegacyAcceptanceRecovery>(`legacy:accept:${playerName}`, async () => {
        const marker = await kv.get<LegacyAcceptanceMarker>(legacyAcceptedKey(playerName));
        if (!marker) return { status: 'none' };
        const def = LEGACY_BY_ID.get(marker.legacyId);
        if (!def) return { status: 'invalid-marker', legacyId: marker.legacyId };

        const beforeRecord = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const beforeCharacter = (beforeRecord?.character ?? null) as Record<string, unknown> | null;
        if (!beforeRecord || !beforeCharacter) return { status: 'missing' };
        const beforeLegacy = (beforeCharacter.legacy ?? null) as CharacterLegacy | null;
        if (beforeLegacy && beforeLegacy.legacyId !== marker.legacyId) {
            return { status: 'conflict', legacyId: marker.legacyId };
        }

        const now = Date.now();
        const seed: CharacterLegacy = beforeLegacy ?? {
            legacyId: marker.legacyId,
            stage: 1,
            acceptedAt: Number.isFinite(Number(marker.ts)) ? Number(marker.ts) : now,
            eraBorn: Number.isFinite(Number(marker.eraBorn))
                ? Number(marker.eraBorn)
                : await currentEraNumber(),
            titles: [],
        };
        const saveOut = await commitLegacyAcceptance(
            playerName,
            seed,
            AURA_STONES_BY_RARITY[def.rarity] ?? 0,
            now,
        );
        if (saveOut.status !== 'ok') return { status: saveOut.status, legacyId: marker.legacyId };

        const trialOut = await ensureAcceptanceTrial(
            playerName,
            def,
            saveOut.legacy,
            saveOut.character,
            now,
        );
        const offerKey = `legacy:sage-offer:${playerName}`;
        const offer = await kv.get<Record<string, unknown>>(offerKey);
        if (offer && offer.status !== 'accepted') {
            await kv.set(offerKey, {
                ...offer,
                status: 'accepted',
                acceptedAt: saveOut.receipt.committedAt,
                acceptedLegacyId: def.id,
            }, { ex: OFFER_TTL_SECONDS });
        }
        const effectsDelivered = await deliverLegacyAcceptanceEffects(
            playerName,
            marker.actor || fallbackActor,
            def,
            saveOut.receipt,
        );
        return {
            status: 'ok',
            def,
            record: saveOut.record,
            character: saveOut.character,
            legacy: saveOut.legacy,
            receipt: saveOut.receipt,
            trial: trialOut.trial,
            stats: trialOut.stats,
            repaired: saveOut.changed || trialOut.created,
            effectsPending: !effectsDelivered,
        };
    }, { failClosed: true });
}
