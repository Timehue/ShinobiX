/*
 * THE PLAYER-CHALLENGE PET DUEL — one fight for both participants.
 *
 * A casual or clan-war pet challenge (`mode: 'clanWarPet'`) used to resolve
 * TWICE, independently, and the two resolutions had nothing to do with each
 * other:
 *
 *   - each client called `/api/pet/battle-start` for itself, and that endpoint
 *     minted its own `randomInt` SEED and sealed its own `authoritativeOutcome`
 *     from it — so the challenger and the responder were rated on two different
 *     fights, and both could honestly be told they won;
 *   - each client then ran `runPetDuelCinematic` locally, a DIFFERENT engine
 *     from the `runPetDuel` the server sealed the outcome with, so what a
 *     player watched could disagree with what they were paid for even within
 *     one client.
 *
 * This is the same fault §10 of the scope doc found in ranked, one step worse:
 * ranked at least resolved once per match on the server. Here the fight had no
 * single existence at all.
 *
 * So the duel is sealed ONCE, against the CHALLENGE, at the moment the responder
 * accepts — the only point where the server has both rosters in hand and has
 * already validated them against both saves (`api/player/challenge.ts`). One
 * seed, one pair of teams, one verdict. `battle-start` reads this seal instead
 * of inventing a fight, and both clients watch the same script.
 *
 * WHY THE SEAL IS BUILT AT ACCEPT, NOT AT battle-start. `battle-start` takes
 * `opponentPetIds` from the caller. That is survivable while each side resolves
 * its own fight, but the moment one fight binds BOTH players it would let the
 * first caller choose which of their opponent's pets has to fight. The accept
 * handler has already checked both id lists against both owners' saves, so
 * sealing there is the only place where neither side picks for the other.
 *
 * FORMAT FOLLOWS THE CHALLENGE — 1v1 or 2v2, whichever was agreed, with no
 * bench. `WAR_DUEL_FORMAT`'s forced 2v2-plus-bench is a ruling about WAR duels,
 * where the roster that arrived was an accident of the submission flow. A
 * player-agreed 1v1 is not that: both sides picked one pet, and filling three
 * more in behind them from their rosters would be a different match than the one
 * they consented to.
 *
 * CONSUMABLES DO NOT FIRE, gear does — the same split war duels make, for the
 * same reason. The fight is decided when the responder accepts, before either
 * client reports anything, so a consumable burned here could never be honestly
 * charged: it would be spent by a fight that already happened whether or not its
 * owner ever settles.
 *
 * DETERMINISM: `resolvePvpPetDuel` may not read a clock, a save or a random
 * source. Both participants re-derive the script from the stored seal on their
 * own machines' schedule, and two derivations must be byte-identical forever.
 */

import { randomInt } from 'node:crypto';
import { kv } from '../_storage.js';
import { resolveWarDuel } from '../_pet-showdown/war-duel.js';
import { sealPetToCeiling } from '../_pet-showdown/war-team.js';
import { petCombatBusyReason } from './_pet-busy.js';
import { activeCarriedPets } from '../_entitlements.js';
import type { ShowdownReplayScript } from '../../shared/pet-showdown-contract.js';
import type { Pet } from '../_pet-sim/pet-types.js';

/** As long as a Showdown session's lease. A challenge expires in ten minutes,
 *  but the duel it sealed has to outlive both participants' trip through the
 *  battle screen, including a refresh. */
const PVP_DUEL_TTL_SECONDS = 45 * 60;

export interface PvpPetDuelSeal {
    challengeId: string;
    /** Canonically ordered by account name, so the seal is identical whichever
     *  participant's accept produced it and the fight cannot depend on who
     *  asked. `a` fights as the engine's player side. */
    a: string;
    b: string;
    aPets: Pet[];
    bPets: Pet[];
    /** Never 3v3: a challenge is one pet each or two, and the format is the
     *  shape both players agreed to rather than a roster fill. */
    format: '1v1' | '2v2';
    seed: number;
    sealedAt: number;
}

export interface PvpPetDuelResolution {
    /** The winner's account NAME, never a side. Both participants read this
     *  same object and must never be handed different answers. */
    winnerName: string;
    script: ShowdownReplayScript;
}

export const pvpPetDuelKey = (challengeId: string): string => `pet:pvp-duel:${challengeId}`;

function isPetArray(value: unknown, size: number): value is Pet[] {
    return Array.isArray(value)
        && value.length === size
        && value.every((pet) => !!pet && typeof pet === 'object' && typeof (pet as { id?: unknown }).id === 'string');
}

export function isPvpPetDuelSeal(value: unknown): value is PvpPetDuelSeal {
    if (!value || typeof value !== 'object') return false;
    const seal = value as Record<string, unknown>;
    if (typeof seal.challengeId !== 'string' || !seal.challengeId) return false;
    if (typeof seal.a !== 'string' || !seal.a) return false;
    if (typeof seal.b !== 'string' || !seal.b) return false;
    if (seal.format !== '1v1' && seal.format !== '2v2') return false;
    if (!Number.isSafeInteger(seal.seed)) return false;
    const size = seal.format === '2v2' ? 2 : 1;
    return isPetArray(seal.aPets, size) && isPetArray(seal.bPets, size);
}

/** Inline `data:` sprite blobs are megabytes of payload the engine never reads.
 *  Hosted URL refs stay — they are small and the client resolves art by them. */
function stripInlineArt(pet: Record<string, unknown>): Record<string, unknown> {
    const image = pet.image;
    const bodyImage = pet.bodyImage;
    const inline = (v: unknown) => typeof v === 'string' && v.startsWith('data:');
    if (!inline(image) && !inline(bodyImage)) return pet;
    const out = { ...pet };
    if (inline(out.image)) delete out.image;
    if (inline(out.bodyImage)) delete out.bodyImage;
    return out;
}

/**
 * Seal exactly the pets a player agreed to field — no roster fill.
 *
 * Returns null if any named pet is missing from the owner's carried roster or is
 * busy (breeding, training, an expedition, another battle), which is the same
 * refusal the single-pet sealers made rather than quietly fielding a substitute.
 */
export function sealChallengedPets(
    character: Record<string, unknown>,
    petIds: readonly string[],
): Pet[] | null {
    const roster = activeCarriedPets<Record<string, unknown>>(character);
    const sealed: Pet[] = [];
    for (const id of petIds) {
        const pet = roster.find((p) => String(p?.id ?? '') === String(id));
        if (!pet) return null;
        if (petCombatBusyReason(character, pet)) return null;
        sealed.push(sealPetToCeiling(stripInlineArt(pet)));
    }
    return sealed.length === petIds.length ? sealed : null;
}

/**
 * Write the one duel this challenge resolves to.
 *
 * `nx`, so a retried accept cannot restage a fight that already exists — the
 * first seal is the match, and a second attempt reads it back instead. Returns
 * the seal in force either way, or null when a roster no longer qualifies.
 */
export async function sealPvpPetDuel(args: {
    challengeId: string;
    challengerName: string;
    responderName: string;
    challengerCharacter: Record<string, unknown>;
    responderCharacter: Record<string, unknown>;
    challengerPetIds: readonly string[];
    responderPetIds: readonly string[];
}): Promise<PvpPetDuelSeal | null> {
    const size = args.challengerPetIds.length;
    if (size !== 1 && size !== 2) return null;
    if (args.responderPetIds.length !== size) return null;

    const challengerPets = sealChallengedPets(args.challengerCharacter, args.challengerPetIds);
    const responderPets = sealChallengedPets(args.responderCharacter, args.responderPetIds);
    if (!challengerPets || !responderPets) return null;

    // Canonical ordering: the fight must not depend on which account happened to
    // be the challenger, because the engine's side order feeds its seeded RNG.
    const challengerIsA = args.challengerName.toLowerCase() <= args.responderName.toLowerCase();
    const seal: PvpPetDuelSeal = {
        challengeId: args.challengeId,
        a: challengerIsA ? args.challengerName : args.responderName,
        b: challengerIsA ? args.responderName : args.challengerName,
        aPets: challengerIsA ? challengerPets : responderPets,
        bPets: challengerIsA ? responderPets : challengerPets,
        format: size === 2 ? '2v2' : '1v1',
        seed: randomInt(1, 0x7fffffff),
        sealedAt: Date.now(),
    };
    const key = pvpPetDuelKey(args.challengeId);
    const written = await kv.set(key, seal, { nx: true, ex: PVP_DUEL_TTL_SECONDS });
    if (written) return seal;
    const existing = await kv.get<unknown>(key);
    return isPvpPetDuelSeal(existing) ? existing : null;
}

export async function loadPvpPetDuel(challengeId: string): Promise<PvpPetDuelSeal | null> {
    const stored = await kv.get<unknown>(pvpPetDuelKey(challengeId));
    return isPvpPetDuelSeal(stored) ? stored : null;
}

/**
 * Resolve the sealed duel. Pure over the seal — same seal, same verdict and same
 * event log, forever, on either participant's request.
 */
export function resolvePvpPetDuel(seal: PvpPetDuelSeal): PvpPetDuelResolution {
    const { outcome, script } = resolveWarDuel({
        // Derived from the challenge id, never a clock: the session id feeds the
        // arena/stage pick, so a wall-clock label would restage the same fight
        // differently for the two participants.
        sessionId: `pet-pvp:${seal.challengeId}`,
        seed: seal.seed,
        fromName: seal.a,
        toName: seal.b,
        fromPets: seal.aPets,
        toPets: seal.bPets,
        format: seal.format,
    });
    return { winnerName: outcome === 'from' ? seal.a : seal.b, script };
}

/**
 * The participating-pet snapshot a sealed duel's REWARD TOKEN carries.
 *
 * Shaped to satisfy `parseSealedPetSnapshots` exactly, which is stricter than it
 * looks: it rejects a pet that so much as HAS an `image`, `bodyImage`,
 * `training` or `expedition` key, present-but-null included. Stripping only
 * inline `data:` art (enough for the seal itself) leaves a hosted URL behind and
 * the settlement then 409s on every duel.
 *
 * The consumable slot is emptied for a second reason: a sealed duel does not
 * fire consumables, so an empty slot here makes the settlement's spend step a
 * deliberate no-op instead of quietly eating whatever is equipped now.
 */
export function pvpSettlementSnapshot(pets: readonly Pet[]): Pet[] {
    return pets.map((pet) => {
        const out = { ...(pet as unknown as Record<string, unknown>) };
        delete out.image;
        delete out.bodyImage;
        delete out.training;
        delete out.expedition;
        if (out.loadout && typeof out.loadout === 'object') {
            out.loadout = { ...(out.loadout as Record<string, unknown>), consumable: undefined };
        }
        return out as unknown as Pet;
    });
}

/** The verdict from one participant's point of view. `null` when the name is not
 *  in this duel at all — a caller who is not a participant gets no answer. */
export function pvpPetDuelOutcomeFor(
    seal: PvpPetDuelSeal,
    playerName: string,
    winnerName: string,
): 'win' | 'loss' | null {
    const me = playerName.toLowerCase();
    if (me !== seal.a.toLowerCase() && me !== seal.b.toLowerCase()) return null;
    // Showdown's judge always decides, so there is no draw to represent here.
    return winnerName.toLowerCase() === me ? 'win' : 'loss';
}
