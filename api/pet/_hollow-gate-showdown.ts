import { createHash, randomInt } from 'node:crypto';
import {
    hollowGateHoundName,
    hollowHoundEncounterId,
    type HollowGateHoundKind,
} from '../../shared/hollow-gate-contract.js';
import { createShowdownSession, type ShowdownSession } from '../_pet-showdown/engine.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { activeCarriedPets } from '../_entitlements.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { hollowGateRunKey, type HollowGateRunToken } from '../hollow-gate/_run-token.js';
import {
    HOLLOW_GATE_PET_AUTHORITY_VERSION,
    hollowGateCombatBindingKey,
    isHollowGatePetAuthority,
    parseHollowGatePetResultReceipt,
    validateHollowGatePetClaim,
    type HollowGateCombatBinding,
    type HollowGatePetResultReceipt,
} from '../hollow-gate/_combat-session.js';
import {
    hollowGatePetChildKey,
    hollowGatePetResultKey,
    hollowGateShowdownSidecarKey,
    writeHollowGatePetResult,
} from '../hollow-gate/_pet-authority.js';
import { buildServerHollowHound } from './battle-start.js';
import { showdownBusyIssue } from './_showdown-readiness.js';
import { rollShowdownTeam, type ShowdownFieldSizeRoll } from './_wanderer-showdown.js';

/*
 * The Hollow Gate pet duel, fought on Showdown the way the road beasts fight.
 *
 * "Send pet" on a Hollow Hound encounter opens a server-authoritative Showdown
 * bout with the road Colosseum's own draw (rollShowdownTeam): a random 1v1, 2v2
 * or 3v3, capped by the pets that can take the field. The active pet the player
 * sent always leads; its partners are drawn at random from the other ready
 * carried pets. The run's Hounds are the AI side, one server-built Hound per
 * fielded pet (buildServerHollowHound, the one Hound definition).
 *
 * THE PARENT CHOOSES THE PROOF. combat-start mints the binding with a Showdown
 * proof id, and that id IS the session id. So this admission never picks an
 * identity of its own: it opens the session the parent already named, or
 * resumes it. It runs under the parent binding lock, which the shinobi
 * fallback (retireUnstartedHollowGatePetBinding) and the result writer also
 * take, so a duel is created exactly once and never after its parent retired.
 *
 * NOTHING HERE PAYS. The session is sealed reward-ineligible. Its terminal turn
 * (or a concession) writes the exact `hg-pet-result` receipt, and
 * /api/hollow-gate/combat-settle pays the encounter from the run's own reward
 * table and ledger, once, under its `hg-combat-paid` marker. A loss records a
 * pet defeat there: the encounter is withdrawn, unpaid, until it is won.
 */

// Matches /api/pet/showdown's ordinary 45-minute session lease.
const SESSION_TTL_SECONDS = 45 * 60;
// The road Colosseum's AI tier. The Hounds fight with the same tactics.
const HOUND_TACTICS = 'warrior' as const;
const PACK_MARKS = ['A', 'B', 'C'] as const;

/** Server-only bookkeeping stored beside a bound session and never surfaced to
 *  the client: which run the terminal result settles, and which pets fought. */
export interface ShowdownHollowGateBinding { runId: string; petIds: string[] }
export const showdownHollowGateKey = hollowGateShowdownSidecarKey;
const sessionKey = (playerName: string, sessionId: string) => hollowGatePetChildKey(playerName, 'showdown', sessionId);

/** Mint the exact versioned receipt Hollow Gate's settlement endpoint consumes.
 *  The writer accepts it only when the parent had already selected this
 *  Showdown session id; an unbound legacy parent cannot adopt a terminal
 *  session after its outcome is known. Idempotent for the same facts. */
export async function mintHollowGatePetReceipt(
    playerName: string,
    sessionId: string,
    binding: ShowdownHollowGateBinding,
    outcome: 'win' | 'loss',
): Promise<boolean> {
    const receipt: HollowGatePetResultReceipt = {
        version: HOLLOW_GATE_PET_AUTHORITY_VERSION,
        engine: 'showdown',
        proofId: sessionId,
        playerName,
        runId: binding.runId,
        outcome,
        playerPetIds: binding.petIds,
        settledAt: Date.now(),
    };
    return writeHollowGatePetResult(receipt);
}

// Test seam for the one random choice the tests must pin: the field size.
let rollOverride: ShowdownFieldSizeRoll | undefined;
export function __setHollowGateFieldSizeRollForTest(roll: ShowdownFieldSizeRoll | null): void {
    rollOverride = roll ?? undefined;
}

/**
 * The run's Hounds for one duel: one per fielded pet, each the server's single
 * Hound definition scaled off the pet it faces. A 3v3 is three of the 1v1
 * mirrors sharing a field, never one bigger creature. The Alpha keeps its name
 * and leads its floor's Hounds. Ids stay in the Hollow Hound namespace, which
 * is what the client renders as a Hound.
 */
export function buildHollowGateHoundPack(
    binding: Pick<HollowGateCombatBinding, 'runId' | 'floor' | 'kind'>,
    fielded: readonly Pet[],
): { pets: Pet[]; teamName: string } {
    const kind = binding.kind as HollowGateHoundKind;
    const leadName = hollowGateHoundName(binding.floor, kind);
    const packmateName = kind === 'boss' ? hollowGateHoundName(binding.floor, 'beast') : leadName;
    const pack = fielded.length > 1;
    const idBase = 1_700_000_000_000 + parseInt(createHash('sha256').update(binding.runId).digest('hex').slice(0, 8), 16);
    const pets = fielded.map((pet, index) => {
        const name = !pack ? leadName
            : kind === 'boss' ? (index === 0 ? leadName : `${packmateName} ${PACK_MARKS[index - 1]}`)
                : `${leadName} ${PACK_MARKS[index]}`;
        return { ...buildServerHollowHound(pet, binding.floor, hollowHoundEncounterId(idBase + index), kind), name } as Pet;
    });
    return { pets, teamName: pack ? `${leadName} Pack` : leadName };
}

function parseRef(value: unknown): { runId: string; token: string } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const ref = value as Record<string, unknown>;
    const runId = typeof ref.runId === 'string' ? ref.runId.slice(0, 96) : '';
    const token = typeof ref.token === 'string' ? ref.token.slice(0, 64) : '';
    return runId && token ? { runId, token } : null;
}

export type HollowGateShowdownStart =
    | { ok: true; kind: 'session'; session: ShowdownSession; petIds: string[]; resumed: boolean }
    /** The duel ended and its session lease lapsed before the Gate settled it. */
    | { ok: true; kind: 'decided'; petReceipt: string; outcome: 'win' | 'loss' | 'draw' }
    | { ok: false; status: number; error: string };

/**
 * Open, or resume, the Showdown duel a Pet-mode Hollow Gate encounter names.
 * A refusal changes nothing, so the browser can fall back to a shinobi fight.
 */
export async function startHollowGatePetShowdown(playerName: string, rawRef: unknown): Promise<HollowGateShowdownStart> {
    const ref = parseRef(rawRef);
    if (!ref) return { ok: false, status: 400, error: 'A Hollow Gate run token and encounter are required.' };
    const bindingKey = hollowGateCombatBindingKey(ref.runId);

    const admitted = await withKvLock(bindingKey, async (): Promise<HollowGateShowdownStart> => {
        const [binding, run] = await Promise.all([
            kv.get<HollowGateCombatBinding>(bindingKey),
            kv.get<HollowGateRunToken>(hollowGateRunKey(playerName, ref.token)),
        ]);
        const validation = validateHollowGatePetClaim({ binding, activeEncounter: run?.activeEncounter, playerName, token: ref.token });
        if (!validation.ok) return { ok: false, status: 409, error: `Hollow Gate pet encounter rejected: ${validation.reason}.` };
        const parent = validation.binding;
        if (parent.runId !== ref.runId) return { ok: false, status: 409, error: 'Hollow Gate pet encounter binding drifted.' };
        const authority = isHollowGatePetAuthority(parent.petAuthority) ? parent.petAuthority : null;
        if (authority?.engine !== 'showdown') {
            // A cinematic proof predates the Showdown cutover. Leave it as it
            // is: the browser's shinobi fallback can still retire it untouched.
            return { ok: false, status: 409, error: 'This encounter was sealed for an older pet duel. Fight it yourself instead.' };
        }
        const sessionId = authority.proofId;
        const sidecarKey = showdownHollowGateKey(playerName, sessionId);

        const existing = await kv.get<ShowdownSession>(sessionKey(playerName, sessionId));
        if (existing) {
            if (existing.playerName !== playerName || existing.sessionId !== sessionId || existing.bindingKind !== 'hollow-gate') {
                return { ok: false, status: 409, error: 'This Hollow Gate pet duel conflicts with its encounter.' };
            }
            // A reload resumes the same duel: same format, same pets, same
            // Hounds, same round. Its run record rides the session's lease.
            const petIds = existing.player.map((pet) => pet.id);
            await kv.set(sidecarKey, { runId: parent.runId, petIds } satisfies ShowdownHollowGateBinding, { ex: SESSION_TTL_SECONDS });
            return { ok: true, kind: 'session', session: existing, petIds, resumed: true };
        }
        const decided = parseHollowGatePetResultReceipt(await kv.get(hollowGatePetResultKey(playerName, sessionId)));
        if (decided) return { ok: true, kind: 'decided', petReceipt: sessionId, outcome: decided.outcome };

        const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${playerName}`);
        const character = save?.character;
        if (!character) return { ok: false, status: 404, error: 'No save found.' };
        const carried = activeCarriedPets<Record<string, unknown>>(character) as unknown as Pet[];
        const ready = carried.filter((pet) => !showdownBusyIssue(character, [pet]));
        // The shrine offers "Send pet" only for an active pet cleared for PvE,
        // so that is the pet that leads.
        const lead = ready.find((pet) => String(pet.id) === String(character.activePetId ?? '') && pet.unlockedForPve === true);
        if (!lead) return { ok: false, status: 409, error: 'Your active pet cannot enter the seal right now.' };

        const { format, chosen } = rollShowdownTeam(ready, { lead, roll: rollOverride });
        const hounds = buildHollowGateHoundPack(parent, chosen);
        if (!chosen.length || hounds.pets.length !== chosen.length) {
            return { ok: false, status: 500, error: 'The Hounds could not assemble.' };
        }
        const session = createShowdownSession({
            sessionId, playerName, format, tier: HOUND_TACTICS, seed: randomInt(1, 0x7fffffff),
            playerPets: chosen, enemyPets: hounds.pets, enemyTeamName: hounds.teamName,
            // The Gate pays this encounter from its own run ledger; the duel never does.
            rewardEligible: false,
        });
        session.bindingKind = 'hollow-gate';
        const petIds = chosen.map((pet) => String(pet.id));
        // The run record first: a bound session must never exist without it.
        await kv.set(sidecarKey, { runId: parent.runId, petIds } satisfies ShowdownHollowGateBinding, { ex: SESSION_TTL_SECONDS });
        await kv.set(sessionKey(playerName, sessionId), session, { ex: SESSION_TTL_SECONDS });
        return { ok: true, kind: 'session', session, petIds, resumed: false };
    }, { failClosed: true });

    // A decided duel whose finishing reply was lost may still lack its
    // receipt. Re-seal the exact same facts (idempotent) so the Gate can settle
    // it. The writer takes the binding lock itself, so this runs after it.
    if (admitted.ok && admitted.kind === 'session' && admitted.session.finished && admitted.session.outcome) {
        await mintHollowGatePetReceipt(playerName, admitted.session.sessionId, { runId: ref.runId, petIds: admitted.petIds }, admitted.session.outcome);
    }
    return admitted;
}
