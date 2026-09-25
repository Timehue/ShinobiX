import { randomInt, randomUUID } from 'node:crypto';
import { SHOWDOWN_FORMAT_SIZE, type ShowdownFormat } from '../../shared/pet-showdown-contract.js';
import { buildColosseumAiTeam } from '../_pet-showdown/ai.js';
import { createShowdownSession, type ShowdownSession } from '../_pet-showdown/engine.js';
import { activeCarriedPets } from '../_entitlements.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { kv } from '../_storage.js';
import { resolveNaturalWorldWanderer } from '../missions/_world-ai-fight.js';
import { savedCurrentSector } from '../missions/_mission-progress-receipt.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    claimWandererUseCooldown,
    currentWandererCooldownUntil,
    parseNaturalWandererId,
    WANDERER_ENCOUNTER_COOLDOWN_MS,
    WANDERER_ENCOUNTER_COOLDOWN_SECONDS,
    withWandererUseState,
} from '../sector/_wanderer-encounter.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { showdownBusyIssue } from './_showdown-readiness.js';

// The session lease matches /api/pet/showdown's ordinary 45-minute lease.
const SESSION_TTL_SECONDS = 45 * 60;
type WandererRef = { id: string; sector: number };
type WandererShowdownPointer = {
    sessionId: string;
    wanderer: WandererRef;
    createdAt: number;
    petIds: string[];
};

const pointerKey = (playerName: string, id: string) => `pet:showdown:wanderer:${playerName}:${id}`;
const sessionKey = (playerName: string, id: string) => `pet:showdown:${playerName}:${id}`;

export function wandererShowdownFormat(readyCount: number, roll: number): ShowdownFormat {
    const maximum = Math.min(3, Math.max(1, Math.floor(readyCount)));
    const size = Math.min(maximum, Math.max(1, Math.floor(roll)));
    return `${size}v${size}` as ShowdownFormat;
}

function shufflePets(pets: Pet[]): Pet[] {
    const shuffled = [...pets];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = randomInt(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/** Rolls a field size from 1 to `maximum`, both inclusive. */
export type ShowdownFieldSizeRoll = (maximum: number) => number;
const rollFieldSize: ShowdownFieldSizeRoll = (maximum) => randomInt(1, maximum + 1);

/**
 * The road Colosseum's team draw: a random 1v1, 2v2 or 3v3, never larger than
 * the ready pets can field, then a shuffled team of exactly that size with no
 * bench. A `lead` always takes the field; the rest of the team is drawn at
 * random from the other ready pets. The Hollow Gate pet duel uses this same
 * draw, so the two encounters cannot drift apart.
 */
export function rollShowdownTeam(
    ready: Pet[],
    options: { lead?: Pet; roll?: ShowdownFieldSizeRoll } = {},
): { format: ShowdownFormat; chosen: Pet[] } {
    const { lead, roll = rollFieldSize } = options;
    const others = lead ? ready.filter((pet) => pet.id !== lead.id) : ready;
    const fieldable = others.length + (lead ? 1 : 0);
    const format = wandererShowdownFormat(fieldable, roll(Math.max(1, Math.min(3, fieldable))));
    const drawn = shufflePets(others);
    return { format, chosen: (lead ? [lead, ...drawn] : drawn).slice(0, SHOWDOWN_FORMAT_SIZE[format]) };
}

function parseRef(value: unknown): WandererRef | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const ref = value as Record<string, unknown>;
    const id = typeof ref.id === 'string' ? ref.id.trim().slice(0, 96) : '';
    const sector = Number(ref.sector);
    return id && parseNaturalWandererId(id) && Number.isSafeInteger(sector) && sector > 0
        ? { id, sector }
        : null;
}

export async function startNaturalWandererShowdown(playerName: string, rawRef: unknown) {
    const wanderer = parseRef(rawRef);
    if (!wanderer) return { ok: false as const, status: 400, error: 'A natural wanderer and sector are required.' };

    const mutation = await mutatePlayerSave(playerName, async ({ record, character }) => {
        const key = pointerKey(playerName, wanderer.id);
        const retained = await kv.get<WandererShowdownPointer>(key);
        if (retained && (retained.wanderer.id !== wanderer.id || retained.wanderer.sector !== wanderer.sector)) {
            return { ok: false as const, status: 409, error: 'This wanderer is bound to another encounter.' };
        }
        const existing = retained ? await kv.get<ShowdownSession>(sessionKey(playerName, retained.sessionId)) : null;
        if (retained && (!existing || existing.playerName !== playerName)) {
            return { ok: false as const, status: 409, error: 'This wanderer has already moved on.' };
        }
        if (existing?.finished) {
            return { ok: false as const, status: 409, error: 'This wanderer fight has already ended.' };
        }

        const retainedState = retained
            ? withWandererUseState(character, wanderer.id, retained.createdAt, wanderer.sector)
            : null;
        const applied = retainedState !== null
            && Number((character.wandererCooldowns as Record<string, unknown> | undefined)?.[wanderer.id]) === Number(retained?.createdAt) + WANDERER_ENCOUNTER_COOLDOWN_MS
            && Number((character.wandererMoves as Record<string, unknown> | undefined)?.[wanderer.id]) === retainedState.moveToSector;
        if (!applied) {
            if (savedCurrentSector(record) !== wanderer.sector) {
                return { ok: false as const, status: 409, error: 'You are not in that sector.' };
            }
            const presence = sectorPresenceBlock(playerName, wanderer.sector);
            if (presence) return { ok: false as const, status: presence.status, error: presence.error };
            const natural = resolveNaturalWorldWanderer(wanderer.id, character, wanderer.sector, retained?.createdAt ?? Date.now());
            if (natural?.verb !== 'petDuel') {
                return { ok: false as const, status: 409, error: 'That beast is no longer offering a pet challenge.' };
            }
        }

        let pointer = retained;
        let session = existing;
        if (!pointer || !session) {
            if (currentWandererCooldownUntil(character, wanderer.id, Date.now())) {
                return { ok: false as const, status: 409, error: 'That beast has already moved on.' };
            }
            const carried = activeCarriedPets<Record<string, unknown>>(character) as unknown as Pet[];
            const ready = carried.filter((pet) => !showdownBusyIssue(character, [pet]));
            if (!ready.length) {
                return { ok: false as const, status: 409, error: 'You need a ready carried pet to answer this challenge.' };
            }
            const { format, chosen } = rollShowdownTeam(ready);
            const seed = randomInt(1, 0x7fffffff);
            const built = buildColosseumAiTeam(chosen, chosen.length, 'warrior', seed, true);
            if (built.pets.length !== chosen.length) {
                return { ok: false as const, status: 500, error: 'The beast could not assemble its team.' };
            }
            const sessionId = randomUUID().replace(/-/g, '');
            const challenger = resolveNaturalWorldWanderer(wanderer.id, character, wanderer.sector, Date.now());
            session = createShowdownSession({
                sessionId, playerName, format, tier: 'warrior', seed,
                playerPets: chosen, enemyPets: built.pets, enemyTeamName: challenger?.name ?? built.teamName,
                rewardEligible: false,
            });
            pointer = { sessionId, wanderer, createdAt: Date.now(), petIds: chosen.map((pet) => pet.id) };
            await kv.set(sessionKey(playerName, sessionId), session, { ex: SESSION_TTL_SECONDS });
            if (await kv.set(key, pointer, { nx: true, ex: WANDERER_ENCOUNTER_COOLDOWN_SECONDS }) !== 'OK') {
                return { ok: false as const, status: 409, error: 'Another wanderer challenge began first. Retry to resume it.' };
            }
        }

        const claim = await claimWandererUseCooldown(
            kv, playerName, wanderer.id, Date.now(), `pet-showdown:${pointer.sessionId}`, pointer.createdAt,
        );
        if (!claim.ok) {
            return { ok: false as const, status: 409, error: 'That beast has already moved on.' };
        }
        const next = withWandererUseState(character, wanderer.id, pointer.createdAt, wanderer.sector);
        return {
            ok: true as const,
            character: applied ? character : next.character,
            value: { session, petIds: pointer.petIds },
            write: !applied,
        };
    });
    if (!mutation.ok) return mutation;
    return {
        ok: true as const,
        session: mutation.value.session,
        petIds: mutation.value.petIds,
        character: mutation.character,
        _saveVersion: mutation._saveVersion,
    };
}
