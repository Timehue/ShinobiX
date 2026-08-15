/*
 * Anbu Vault Infiltration — client API + feature flag.
 *
 * Thin typed wrappers over the single server route (api/village/anbu-infiltration,
 * action switch). Combat itself uses the normal Solo PvE action/state routes;
 * this module owns only raid start, binding-context restore, settlement, and
 * cache turn-in.
 *
 * Auth headers are attached by the global authFetch interceptor; the server
 * cross-validates playerName against them.
 */
import type { SoloPveSession } from './solo-pve-api';
import type { Character } from '../types/character';
import type { CapabilityAvailability } from './live-capabilities';
import { capabilityPreferenceAllowsAdmission } from './live-capability-admission';

// ── Feature toggle (client half) ─────────────────────────────────────────────
/** Presentation preference only. localStorage `anbuInfiltration.v1` = "0" is
 *  the only opt-out; anything else (incl. unset) is ON. Admission callers must
 *  use anbuInfiltrationAdmissionEnabled so this preference can never override
 *  the server-published public capability state. */
export function anbuInfiltrationEnabled(): boolean {
    try {
        return localStorage.getItem('anbuInfiltration.v1') !== '0';
    } catch {
        return true;
    }
}

/** True only when both the local presentation preference and public service
 * truth permit a NEW infiltration. Existing recovery/turn-in UI may continue
 * to use the presentation preference without opening another run. */
export function anbuInfiltrationAdmissionEnabled(availability: CapabilityAvailability): boolean {
    return capabilityPreferenceAllowsAdmission(anbuInfiltrationEnabled(), availability);
}

// ── Per-village masked Anbu defender (public/anbu/<slug>.webp) ────────────────
// Anbu are anonymous masked operatives, so the vault's boss room shows a
// village-signature masked figure, not the real appointee's face (their loadout
// still drives combat). slug KEEP IN SYNC with scripts/gen-anbu-vault-art.mjs.
const ANBU_AVATAR_BY_VILLAGE: Record<string, string> = {
    'Moonshadow Village': 'moonshadow',
    'Stormveil Village': 'stormveil',
    'Ashen Leaf Village': 'ashenleaf',
    'Frostfang Village': 'frostfang',
};

/** The masked-Anbu standee/portrait for a village (null if not a known war village). */
export function anbuAvatarForVillage(village: string): string | null {
    const slug = ANBU_AVATAR_BY_VILLAGE[village];
    return slug ? `/anbu/${slug}.webp` : null;
}

/** The masked display name for the defender — "The Frostfang Anbu" (anonymity). */
export function anbuDisplayName(village: string): string {
    const short = village.replace(/\s+Village$/i, '').trim();
    return `The ${short || 'Village'} Anbu`;
}

// ── Reward / turn-in shapes (mirror api/village/anbu-infiltration.ts) ─────────
export type InfilCachePool = 'warSupply' | 'warResources';

/** The itemStacks ids the raid mints — KEEP IN SYNC with api/_anbu-infiltration.ts CACHE_ITEM_IDS. */
export const INFIL_CACHE_ITEM_IDS: Record<InfilCachePool, string> = {
    warSupply: 'war-supply-cache',
    warResources: 'war-resource-cache',
};

export type InfilStartResponse = {
    ok: true;
    runId: string;
    sector: number;
    targetVillage: string;
    anbu: { name: string };
    session: SoloPveSession;
};

export type InfilReportResponse =
    | { ok: true; won: false; alreadySettled?: boolean; character?: Character; _saveVersion?: number }
    | { ok: true; won: true; alreadySettled: true }
    | {
        ok: true; won: true; alreadySettled: false;
        rolled: { supply: boolean; wr: boolean };
        supplySkim: number; wrSkim: number;
        supplyCaches: number; wrCaches: number;
        ryo: number; overflowLost: number;
        character: Character;
        _saveVersion: number;
    };

export type InfilTurnInResponse =
    | { ok: false; reason: 'nothing-to-turn-in' | 'cap-reached' }
    | { ok: true; dest: 'clan' | 'village'; points: number; consumed: number; remaining: number; _saveVersion: number };

const ROUTE = '/api/village/anbu-infiltration';

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

/** Begin an infiltration of an enemy-held war sector. The server picks + seals the
 *  defending Anbu, builds the vault fight, and returns the live session. */
export function startInfiltration(
    playerName: string,
    sector: number,
): Promise<InfilStartResponse> {
    return post({ action: 'start', playerName, sector });
}

/** Reconnect / poll the live run (refresh-restore). */
export async function fetchInfiltrationState(runId: string, playerName: string): Promise<{ session: SoloPveSession; sector: number; targetVillage: string; anbu: { name: string } }> {
    return post({ action: 'state', runId, playerName });
}

/** Settle a FINISHED run. Win → the server rolls the skim and mints caches + ryo;
 *  loss → { won:false }. Fresh outcomes include the server-settled character. */
export function reportInfiltration(runId: string, playerName: string): Promise<InfilReportResponse> {
    return post({ action: 'report', runId, playerName });
}

/** Convert held caches into standing points — type-locked (War Supply → clan 2:1,
 *  War Resource → village merit 1:1). Omit count to turn in everything held. */
export function turnInInfilCaches(
    playerName: string,
    cache: InfilCachePool,
    count?: number,
): Promise<InfilTurnInResponse> {
    return post({ action: 'turn-in', playerName, cache, ...(count && count > 0 ? { count } : {}) });
}
