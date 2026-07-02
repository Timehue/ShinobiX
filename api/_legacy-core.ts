/*
 * Legacy progression core — trial derivation and the character.legacy shape.
 *
 * Trials are derived mechanically from a legacy's category + rarity as
 * FRESH-DELTA objectives over the server-owned counters (api/_legacy-track.ts):
 * "prove it again, under our eyes". Because the counters only move through
 * server settle endpoints, a trial needs no mint-token of its own — the sealed
 * baseline in `legacy:trial:<player>` plus the single-active-trial rule is the
 * whole anti-cheat story. Authored per-legacy trials can override these
 * defaults later via the shared:legacy-defs overlay without touching code.
 */
import type { LegacyCategory, LegacyDef, LegacyRarity, LegacyStatKey } from './_legacy-defs.js';

export type TrialKind = 'awaken' | 'bind' | 'prove' | 'mythic';
// stage 1→2 (Awakened), 2→3 (Bound), 3→4 (Proven), 4→5 (Mythic)

export type TrialObjective = { stat: LegacyStatKey; delta: number };

export type LegacyTrial = {
    legacyId: string;
    kind: TrialKind;
    startedAt: number;
    attempt: number;
    /** Counter values sealed at start; progress = current - baseline. */
    baselines: Partial<Record<LegacyStatKey, number>>;
    objectives: TrialObjective[];
};

/** The server-owned save field. The save sanitizer re-injects this from the
 *  stored record, so nothing the client autosaves can move a stage. */
export type CharacterLegacy = {
    legacyId: string;
    stage: 1 | 2 | 3 | 4 | 5;
    acceptedAt: number;
    awakenedAt?: number;
    boundAt?: number;
    provenAt?: number;
    mythicAt?: number;
    /** Titles granted by this legacy (also appended to earnedTitles). */
    titles: string[];
};

/** Prestige title variants granted at the later stages (handoff: Stage 4
 *  "stronger/prestige title", Stage 5 "mythic title"). Registered as
 *  server-credited in api/_titles-registry.ts so they can't be typed in. */
export function provenTitleFor(baseTitle: string): string {
    return `Proven ${baseTitle}`;
}
export function mythicTitleFor(baseTitle: string): string {
    return `Eternal ${baseTitle}`;
}

export const legacyTrialKey = (player: string) => `legacy:trial:${player}`;
export const legacyAcceptedKey = (player: string) => `legacy:accepted:${player}`;

/** Per-category trial templates: the stat(s) a trial re-proves, with the delta
 *  a BASIC-rarity awaken trial demands. Rarity and stage scale from here. */
// Every template stat here MUST have a live server-side write path (enforced
// by the dead-stat lint in _legacy-defs.test.ts) — a trial objective over a
// stat nothing increments would strand the player at their current stage
// FOREVER, because a legacy can never be exchanged (verification finding).
const TRIAL_TEMPLATES: Record<LegacyCategory, ReadonlyArray<TrialObjective>> = {
    ninjutsu: [{ stat: 'ninjutsuKills', delta: 12 }],
    genjutsu: [{ stat: 'genjutsuKills', delta: 12 }],
    taijutsu: [{ stat: 'taijutsuKills', delta: 12 }],
    bukijutsu: [{ stat: 'bukijutsuKills', delta: 12 }],
    pvp: [{ stat: 'pvpWins', delta: 6 }],
    pve: [{ stat: 'missionCompletions', delta: 10 }, { stat: 'pveKills', delta: 40 }],
    village: [{ stat: 'villageDonations', delta: 5000 }, { stat: 'warContribution', delta: 3000 }],
    support: [{ stat: 'healingDone', delta: 15_000 }],
    explorer: [{ stat: 'sectorDiscoveries', delta: 3 }, { stat: 'wandererQuests', delta: 2 }],
    pets: [{ stat: 'petExpeditions', delta: 6 }],
    cards: [{ stat: 'cardClashWins', delta: 8 }],
    war: [{ stat: 'warContribution', delta: 4500 }],
    mythic: [{ stat: 'missionCompletions', delta: 12 }, { stat: 'pvpWins', delta: 6 }],
};

const RARITY_FACTOR: Record<LegacyRarity, number> = { basic: 1, rare: 1.75, legendary: 3, mythic: 4.5 };
const KIND_FACTOR: Record<TrialKind, number> = { awaken: 1, bind: 1.5, prove: 2.5, mythic: 4 };

export function trialObjectivesFor(def: LegacyDef, kind: TrialKind): TrialObjective[] {
    const factor = RARITY_FACTOR[def.rarity] * KIND_FACTOR[kind];
    return TRIAL_TEMPLATES[def.category].map((t) => ({
        stat: t.stat,
        delta: Math.max(1, Math.round(t.delta * factor)),
    }));
}

/** Which trial kind moves a player at `stage` forward, or null if none does. */
export function nextTrialKind(stage: number): TrialKind | null {
    if (stage === 1) return 'awaken';
    if (stage === 2) return 'bind';
    if (stage === 3) return 'prove';
    if (stage === 4) return 'mythic';
    return null;   // stage 5 is the summit
}

export function trialProgress(
    trial: LegacyTrial,
    stats: Partial<Record<LegacyStatKey, number>>,
): Array<TrialObjective & { progress: number; done: boolean }> {
    return trial.objectives.map((o) => {
        const base = Number(trial.baselines[o.stat] ?? 0);
        const now = Number(stats[o.stat] ?? 0);
        const progress = Math.max(0, Math.floor(now - base));
        return { ...o, progress: Math.min(progress, o.delta), done: progress >= o.delta };
    });
}
