/**
 * Orin's Stable Exhibition: the live run, kept beside (not inside) the First
 * Pact progress record.
 *
 * A run is a draft of four rented champions out of six, seven stables in a
 * row, and after each win one optional trade of a rental for a companion the
 * player just beat. The rentals are server-built catalog pets: the browser
 * only ever sends ids from this record, never a pet, so nothing about a rental
 * can be argued from the client. Losing ends the run; nothing the player owns
 * is risked or written.
 *
 * What a run EARNS (best, clears, the once-a-day Court Standing) lives on the
 * shared progress record and is settled through settleFirstPactExhibitionSummary.
 */
import { randomInt, randomUUID } from "node:crypto";
import { kv } from "../_storage.js";
import { withKvLock } from "../_lock.js";
import type { Pet } from "../_pet-sim/pet-types.js";
import { buildShowdownAiTeam } from "../_pet-showdown/ai.js";
import {
    FIRST_PACT_EXHIBITION_LENGTH,
    FIRST_PACT_EXHIBITION_POOL_SIZE,
    FIRST_PACT_EXHIBITION_RENTAL_GROWTH,
    FIRST_PACT_EXHIBITION_ROUNDS,
    FIRST_PACT_TEAM_SIZE,
    firstPactExhibitionOpen,
    settleFirstPactExhibitionSummary,
    type FirstPactProgress,
} from "../../shared/first-pact-contract.js";
import { updateFirstPactProgress } from "./_state.js";

const EXHIBITION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** The roles the six rentals are drawn in, so every draft can build pairs. */
const RENTAL_ROLES = ["defender", "sage", "tracker", "assassin", "defender", "assassin"] as const;

export const exhibitionKey = (playerName: string) => `first-pact-exhibition:${playerName}`;

export type ExhibitionStatus = "drafting" | "active" | "won" | "lost";

export type ExhibitionRun = {
    runId: string;
    status: ExhibitionStatus;
    /** Drafting: the six rentals on offer. Afterwards: the four in the run. */
    pool: Pet[];
    /** Rental ids in play order: two leads, then two on the bench. */
    team: string[];
    /** Rounds won in this run. */
    round: number;
    /** After a win: the beaten stable, open to one trade until the next round starts. */
    offered: Pet[] | null;
    battleProofs: string[];
    startedAt: number;
    updatedAt: number;
};

export type ExhibitionView = {
    runId: string;
    status: ExhibitionStatus;
    round: number;
    length: number;
    /** Drafting: the six to choose from. Otherwise empty. */
    pool: Pet[];
    /** The four rentals in play order. */
    team: Pet[];
    offered: Pet[] | null;
    nextRoundId: string | null;
};

export class ExhibitionError extends Error {
    constructor(message: string, readonly status = 409) {
        super(message);
    }
}

export function exhibitionView(run: ExhibitionRun | null): ExhibitionView | null {
    if (!run) return null;
    return {
        runId: run.runId,
        status: run.status,
        round: run.round,
        length: FIRST_PACT_EXHIBITION_LENGTH,
        pool: run.status === "drafting" ? run.pool : [],
        team: run.team.map((id) => run.pool.find((pet) => pet.id === id)).filter((pet): pet is Pet => !!pet),
        offered: run.status === "active" ? run.offered : null,
        nextRoundId: run.status === "active" ? FIRST_PACT_EXHIBITION_ROUNDS[run.round]?.id ?? null : null,
    };
}

export async function readExhibition(playerName: string): Promise<ExhibitionRun | null> {
    const stored = await kv.get<ExhibitionRun>(exhibitionKey(playerName));
    return stored && typeof stored === "object" && typeof stored.runId === "string" ? stored : null;
}

async function mutateExhibition<T>(playerName: string, mutate: (run: ExhibitionRun | null) => { run: ExhibitionRun | null; value: T }): Promise<T> {
    const key = exhibitionKey(playerName);
    return withKvLock(key, async () => {
        const current = await readExhibition(playerName);
        const { run, value } = mutate(current);
        if (run && run !== current) await kv.set(key, run, { ex: EXHIBITION_TTL_SECONDS });
        return value;
    }, { failClosed: true });
}

/** Six rented champions at level 100, one stat share above the plain champion tier. */
export function rollExhibitionPool(seed: number): Pet[] {
    const reference = Array.from({ length: FIRST_PACT_EXHIBITION_POOL_SIZE }, () => ({ level: 100 }) as Pet);
    const built = buildShowdownAiTeam(reference, FIRST_PACT_EXHIBITION_POOL_SIZE, "champion", seed, {
        mirrorLevels: true,
        roster: { roles: RENTAL_ROLES, growthShareBonus: FIRST_PACT_EXHIBITION_RENTAL_GROWTH },
    });
    return built.pets.map((pet, index) => ({ ...pet, id: `rental-${index}-${pet.templateId ?? pet.id}` }));
}

export function startExhibition(playerName: string, progress: FirstPactProgress, now = Date.now()): Promise<ExhibitionRun> {
    if (!firstPactExhibitionOpen(progress)) throw new ExhibitionError("Orin opens the Exhibition only after the crossing is closed.");
    return mutateExhibition(playerName, (current) => {
        if (current && (current.status === "drafting" || current.status === "active")) return { run: current, value: current };
        const seed = randomInt(1, 0x7fffffff);
        const run: ExhibitionRun = {
            runId: randomUUID().replace(/-/g, "").slice(0, 16),
            status: "drafting",
            pool: rollExhibitionPool(seed),
            team: [],
            round: 0,
            offered: null,
            battleProofs: [],
            startedAt: now,
            updatedAt: now,
        };
        return { run, value: run };
    });
}

function distinctIds(value: unknown): string[] {
    return Array.isArray(value) ? [...new Set(value.map((entry) => String(entry ?? "").slice(0, 96)).filter(Boolean))] : [];
}

/** Choose four of the six, in play order. */
export function draftExhibition(playerName: string, petIds: unknown, now = Date.now()): Promise<ExhibitionRun> {
    const ids = distinctIds(petIds);
    if (ids.length !== FIRST_PACT_TEAM_SIZE) throw new ExhibitionError("Choose four different rentals: two to lead and two on the bench.", 400);
    return mutateExhibition(playerName, (current) => {
        if (!current || current.status !== "drafting") throw new ExhibitionError("There is no Exhibition draft open.");
        const chosen = ids.map((id) => current.pool.find((pet) => pet.id === id));
        if (chosen.some((pet) => !pet)) throw new ExhibitionError("Every rental must come from Orin's stalls.");
        const run: ExhibitionRun = { ...current, status: "active", pool: chosen as Pet[], team: ids, updatedAt: now };
        return { run, value: run };
    });
}

/** Re-order the four rentals (the first two lead). */
export function orderExhibition(playerName: string, petIds: unknown, now = Date.now()): Promise<ExhibitionRun> {
    const ids = distinctIds(petIds);
    return mutateExhibition(playerName, (current) => {
        if (!current || current.status !== "active") throw new ExhibitionError("There is no Exhibition run in progress.");
        if (ids.length !== current.team.length || ids.some((id) => !current.team.includes(id))) {
            throw new ExhibitionError("List each of your four rentals once.", 400);
        }
        const run: ExhibitionRun = { ...current, team: ids, updatedAt: now };
        return { run, value: run };
    });
}

/** Trade one rental for one companion of the stable just beaten. One trade per win. */
export function swapExhibition(playerName: string, outPetId: unknown, inPetId: unknown, now = Date.now()): Promise<ExhibitionRun> {
    const outId = String(outPetId ?? "").slice(0, 96);
    const inId = String(inPetId ?? "").slice(0, 96);
    return mutateExhibition(playerName, (current) => {
        if (!current || current.status !== "active" || !current.offered?.length) {
            throw new ExhibitionError("There is no trade on offer. Win a round to earn one.");
        }
        const slot = current.team.indexOf(outId);
        const incoming = current.offered.find((pet) => pet.id === inId);
        if (slot < 0 || !incoming) throw new ExhibitionError("Trade one of your rentals for one companion you just beat.", 400);
        const recruit: Pet = { ...incoming, id: `rental-r${current.round}-${incoming.templateId ?? incoming.id}` };
        const team = current.team.map((id, index) => (index === slot ? recruit.id : id));
        const pool = [...current.pool.filter((pet) => pet.id !== outId), recruit];
        const run: ExhibitionRun = { ...current, team, pool, offered: null, updatedAt: now };
        return { run, value: run };
    });
}

export function abandonExhibition(playerName: string, now = Date.now()): Promise<ExhibitionRun | null> {
    return mutateExhibition(playerName, (current) => {
        if (!current || (current.status !== "drafting" && current.status !== "active")) return { run: current, value: current };
        const run: ExhibitionRun = { ...current, status: "lost", offered: null, updatedAt: now };
        return { run, value: run };
    });
}

/**
 * Open the round the run is due to fight: the rentals in play order. Starting a
 * round closes any trade still open. Throws unless that round is the one asked
 * for. The stable the round faces is sealed with the battle, not here, so a
 * second start of the same round cannot change what an earlier fight offers.
 */
export function beginExhibitionRound(playerName: string, roundId: string, now = Date.now()): Promise<{ runId: string; team: Pet[] }> {
    return mutateExhibition(playerName, (current) => {
        if (!current || current.status !== "active") throw new ExhibitionError("Draft your rentals with Orin before the Exhibition bell.");
        if (FIRST_PACT_EXHIBITION_ROUNDS[current.round]?.id !== roundId) throw new ExhibitionError("That Exhibition round is not next.");
        const team = current.team.map((id) => current.pool.find((pet) => pet.id === id)).filter((pet): pet is Pet => !!pet);
        if (team.length !== FIRST_PACT_TEAM_SIZE) throw new ExhibitionError("The Exhibition run is missing a rental. Abandon it and start again.");
        const run = current.offered ? { ...current, offered: null, updatedAt: now } : current;
        return { run, value: { runId: current.runId, team } };
    });
}

/**
 * Settle one Exhibition battle. `opponents` is the stable sealed with this
 * battle; a win offers it in trade. The lasting summary is written first and is
 * idempotent by proof; the run then advances (or ends) under its own lock. A
 * retried settlement after either write is therefore a no-op for both.
 */
export async function settleExhibitionBattle(
    playerName: string,
    runId: string,
    roundId: string,
    outcome: "win" | "loss",
    proofId: string,
    opponents: Pet[],
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; advanced: boolean; standingPaid: number; exhibition: ExhibitionView | null }> {
    const safeProof = String(proofId).slice(0, 96);
    return withKvLock(exhibitionKey(playerName), async () => {
        const run = await readExhibition(playerName);
        const due = run?.status === "active" && run.runId === runId && FIRST_PACT_EXHIBITION_ROUNDS[run.round]?.id === roundId;
        const repeat = !!run && run.battleProofs.includes(safeProof);
        let standingPaid = 0;
        const progress = await updateFirstPactProgress(playerName, (current) => {
            if (!due || repeat) return current;
            const reached = outcome === "win" ? run!.round + 1 : run!.round;
            const settled = settleFirstPactExhibitionSummary(current, outcome, reached, safeProof, now);
            standingPaid = settled.standingPaid;
            return settled.progress;
        }, now);
        if (!run || !due || repeat) return { progress, advanced: false, standingPaid: 0, exhibition: exhibitionView(run) };
        const won = outcome === "win";
        const reached = won ? run.round + 1 : run.round;
        const finished = won && reached >= FIRST_PACT_EXHIBITION_LENGTH;
        const next: ExhibitionRun = {
            ...run,
            status: !won ? "lost" : finished ? "won" : "active",
            round: reached,
            offered: won && !finished && opponents.length ? opponents : null,
            battleProofs: [...run.battleProofs, safeProof].slice(-12),
            updatedAt: now,
        };
        await kv.set(exhibitionKey(playerName), next, { ex: EXHIBITION_TTL_SECONDS });
        return { progress, advanced: true, standingPaid, exhibition: exhibitionView(next) };
    }, { failClosed: true });
}
