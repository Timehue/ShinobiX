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

export type GarrisonStartResponse = {
    ok: true;
    replayed: boolean;
    runId: string;
    sector: number;
    contestId: string;
    defenderVillage: string;
    anbu: { name: string };
    session: SoloPveSession;
};

/** Assault the sector's ANBU garrison. Unlocks only after the contest has gone
 *  ~2h with no live-player battle (garrisonAssaultable in village-war-map.ts);
 *  a real defender fighting re-locks it. The server picks + seals the
 *  defending village's real appointed ANBU (their actual equipped jutsu, gear,
 *  weapons, and items) and returns a live Solo PvE session — resolved through
 *  the normal /api/solo-pve/action loop, never client-reported. */
export function startGarrisonAssault(playerName: string, sector: number): Promise<GarrisonStartResponse> {
    return post({ action: 'garrison-start', playerName, sector });
}

export type GarrisonResolveResponse =
    | {
        ok: true; outcome: 'stall' | 'superseded'; attackerPoints: number; defenderPoints: number;
        character: Character; _saveVersion: number;
    }
    | {
        ok: true; outcome: 'attacker' | 'garrison'; attackerWon: boolean;
        points: number; attackerPoints: number; defenderPoints: number; endsAt: number;
        character: Character; _saveVersion: number;
    };

/** Settle a FINISHED assault. Reads the authoritative Solo PvE session
 *  server-side (never a client claim) and applies win/loss to the SAME scored
 *  sector-war contest a live-defender fight would — half weight, capped. */
export function resolveGarrisonAssault(runId: string, playerName: string): Promise<GarrisonResolveResponse> {
    return post({ action: 'garrison-resolve', runId, playerName });
}
