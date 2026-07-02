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

export type TrialKind = 'awaken' | 'bind';   // stage 1→2 and stage 2→3

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
    /** Titles granted by this legacy (also appended to earnedTitles). */
    titles: string[];
};

export const legacyTrialKey = (player: string) => `legacy:trial:${player}`;
export const legacyAcceptedKey = (player: string) => `legacy:accepted:${player}`;

/** Per-category trial templates: the stat(s) a trial re-proves, with the delta
 *  a BASIC-rarity awaken trial demands. Rarity and stage scale from here. */
const TRIAL_TEMPLATES: Record<LegacyCategory, ReadonlyArray<TrialObjective>> = {
    ninjutsu: [{ stat: 'ninjutsuKills', delta: 12 }],
    genjutsu: [{ stat: 'genjutsuKills', delta: 12 }],
    taijutsu: [{ stat: 'taijutsuKills', delta: 12 }],
    bukijutsu: [{ stat: 'bukijutsuKills', delta: 12 }],
    pvp: [{ stat: 'pvpWins', delta: 6 }],
    pve: [{ stat: 'missionCompletions', delta: 10 }, { stat: 'pveKills', delta: 40 }],
    village: [{ stat: 'warMissions', delta: 6 }, { stat: 'villageDonations', delta: 5000 }],
    support: [{ stat: 'healingDone', delta: 15_000 }],
    explorer: [{ stat: 'tilesExplored', delta: 120 }, { stat: 'sectorDiscoveries', delta: 4 }],
    pets: [{ stat: 'petDuelWins', delta: 8 }],
    cards: [{ stat: 'cardClashWins', delta: 8 }],
    war: [{ stat: 'warContribution', delta: 8000 }],
    mythic: [{ stat: 'missionCompletions', delta: 12 }, { stat: 'pvpWins', delta: 6 }],
};

const RARITY_FACTOR: Record<LegacyRarity, number> = { basic: 1, rare: 1.75, legendary: 3, mythic: 4.5 };
const BIND_FACTOR = 1.5;

export function trialObjectivesFor(def: LegacyDef, kind: TrialKind): TrialObjective[] {
    const factor = RARITY_FACTOR[def.rarity] * (kind === 'bind' ? BIND_FACTOR : 1);
    return TRIAL_TEMPLATES[def.category].map((t) => ({
        stat: t.stat,
        delta: Math.max(1, Math.round(t.delta * factor)),
    }));
}

/** Which trial kind moves a player at `stage` forward, or null if none does. */
export function nextTrialKind(stage: number): TrialKind | null {
    if (stage === 1) return 'awaken';
    if (stage === 2) return 'bind';
    return null;   // stages 4-5 (Proven/Mythic) arrive in a later wave
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
