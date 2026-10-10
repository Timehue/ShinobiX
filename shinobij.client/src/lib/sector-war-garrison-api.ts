/*
 * Sector War Garrison Assault — client API.
 *
 * Thin typed wrappers over the existing /api/village/sector-war route (the
 * garrison-start / garrison-resolve actions). Combat itself uses the normal
 * Solo PvE action/state routes (lib/solo-pve-api.ts) via the same
 * runtime-neutral Arena shell every other sealed AI fight uses — this module
 * owns only starting the assault and reporting its finished outcome.
 *
 * Auth headers are attached by the global authFetch interceptor; the server
 * cross-validates playerName against them.
 */
import type { SoloPveSession } from './solo-pve-api';
import type { Character } from '../types/character';

const ROUTE = '/api/village/sector-war';

async function post<T>(body: Record<string, unknown>): Promise<T> {
    const res = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Request failed (${res.status})`);
    }
    return res.json() as Promise<T>;
}

export type GarrisonStartResponse =
    | {
        ok: true;
        replayed: boolean;
        settledPrevious?: undefined;
        runId: string;
        sector: number;
        contestId: string;
        defenderVillage: string;
        anbu: { name: string };
        session: SoloPveSession;
    }
    | {
        // The attacker's previous assault on this sector had finished without
        // being reported; the server settled it now and returns ITS result
        // instead of opening another assault.
        ok: true;
        settledPrevious: true;
        runId: string;
        sector: number;
        contestId: string;
        defenderVillage: string;
        anbu: { name: string };
        result: GarrisonResolveResponse;
    };

/** Assault the sector's ANBU garrison. Unlocks only after the contest has gone
 *  ~2h with no live-player battle (garrisonAssaultable in village-war-map.ts);
 *  a real defender fighting re-locks it. The server picks + seals the
 *  defending village's real appointed ANBU (their actual equipped jutsu, gear,
 *  weapons, and items) and returns a live Solo PvE session — resolved through
 *  the normal /api/solo-pve/action loop, never client-reported. An assault the
 *  player already has on the sector comes back instead: still live, it resumes;
 *  finished but unreported, it is settled and its result returned. */
export function startGarrisonAssault(playerName: string, sector: number): Promise<GarrisonStartResponse> {
    return post({ action: 'garrison-start', playerName, sector });
}

/** `lapsed`: the assault sat idle past GARRISON_IDLE_LAPSE_MINUTES and the
 *  server ended it as a walk-out (a loss). */
export type GarrisonResolveResponse =
    | {
        ok: true; outcome: 'stall' | 'superseded'; attackerPoints: number; defenderPoints: number;
        lapsed?: boolean;
        character: Character; _saveVersion: number;
    }
    | {
        ok: true; outcome: 'attacker' | 'garrison'; attackerWon: boolean;
        points: number; attackerPoints: number; defenderPoints: number; endsAt: number;
        lapsed?: boolean;
        character: Character; _saveVersion: number;
    };

/** Settle a FINISHED assault. Reads the authoritative Solo PvE session
 *  server-side (never a client claim) and applies win/loss to the SAME scored
 *  sector-war contest a live-defender fight would — half weight, capped. The
 *  server usually settled it already, the moment the fight ended; this then
 *  replays that cached result. */
export function resolveGarrisonAssault(runId: string, playerName: string): Promise<GarrisonResolveResponse> {
    return post({ action: 'garrison-resolve', runId, playerName });
}

// ─── the assault screen's hand-off and wording ───────────────────────────────

/** How long an assault may sit with no action before the server ends it as a
 *  walk-out (a loss). Mirrors GARRISON_ACTIVE_TTL_SECONDS in
 *  api/_sector-war-garrison-encounter.ts. Every action restarts the clock; the
 *  fight itself has no other time limit. */
export const GARRISON_IDLE_LAPSE_MINUTES = 45;

/** VillageWarMap launches an assault by writing `{ sector }` here. The screen
 *  adds the run it opened and, once that run's result is in, `done`. */
export const GARRISON_STASH_KEY = 'sectorWarGarrison.v1';

export type GarrisonStash = { sector: number; runId?: string; anbuName?: string; done?: boolean };
type StashStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function sessionStore(): StashStore | null {
    try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

export function readGarrisonStash(store: StashStore | null = sessionStore()): GarrisonStash | null {
    try {
        const raw = store?.getItem(GARRISON_STASH_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const sector = Number(parsed.sector);
        if (!Number.isFinite(sector)) return null;
        return {
            sector: Math.floor(sector),
            ...(typeof parsed.runId === 'string' && parsed.runId ? { runId: parsed.runId } : {}),
            ...(typeof parsed.anbuName === 'string' ? { anbuName: parsed.anbuName } : {}),
            ...(parsed.done === true ? { done: true } : {}),
        };
    } catch {
        return null;
    }
}

export function writeGarrisonStash(stash: GarrisonStash, store: StashStore | null = sessionStore()): void {
    try { store?.setItem(GARRISON_STASH_KEY, JSON.stringify(stash)); } catch { /* storage disabled */ }
}

export function clearGarrisonStash(store: StashStore | null = sessionStore()): void {
    try { store?.removeItem(GARRISON_STASH_KEY); } catch { /* storage disabled */ }
}

export type GarrisonMountPlan =
    | { kind: 'lost' }
    | { kind: 'show-result'; runId: string; anbuName: string }
    | { kind: 'start'; sector: number };

/**
 * What a (re)mounted assault screen does with its hand-off.
 *
 * A FINISHED assault is never started over. Every mount used to call
 * garrison-start, and the server, finding that run settled, minted a brand-new
 * assault — so a refresh on the result screen walked the player into another
 * fight. A finished run now shows its result again (the server replays it).
 * Anything else calls garrison-start, which itself resumes a live run.
 */
export function garrisonMountPlan(stash: GarrisonStash | null): GarrisonMountPlan {
    if (!stash) return { kind: 'lost' };
    if (stash.done && stash.runId) return { kind: 'show-result', runId: stash.runId, anbuName: stash.anbuName ?? '' };
    return { kind: 'start', sector: stash.sector };
}

/** The result screen's words. Every branch says what actually happened to the
 *  war: an assault that ended after the war did no longer "changes hands"
 *  nothing — it simply could not count. */
export function garrisonReportCopy(
    report: GarrisonResolveResponse | null,
    anbuName: string,
    earlier = false,
): { title: string; detail: string; note?: string } {
    const name = anbuName || 'The garrison';
    const note = earlier
        ? 'This was your earlier assault on this sector. It finished without being reported, so it has been recorded now.'
        : undefined;
    const withNote = (title: string, detail: string) => (note ? { title, detail, note } : { title, detail });
    if (!report) return withNote('Assault Over', 'The assault is over.');
    if (report.outcome === 'attacker') {
        return withNote('Garrison Fallen', report.points > 0
            ? `${name} fell — +${report.points} to your side's war score.`
            : `${name} fell, but the garrison's war-wide cap is already spent — no points this time.`);
    }
    if (report.outcome === 'garrison') {
        return withNote('The Garrison Held', report.lapsed
            ? `Your assault sat idle for ${GARRISON_IDLE_LAPSE_MINUTES} minutes and counted as a retreat. The garrison scores for the defence.`
            : `${name} repelled your assault. The garrison scores for the defence.`);
    }
    if (report.outcome === 'superseded') {
        return withNote('Assault Over', 'The war on this sector was already over when this assault ended, so it no longer moves the score. The fight still cost what it cost.');
    }
    return withNote('Assault Over', 'The clash ended without a decision — no points changed hands.');
}
