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
    /** Which primary-objective variant this attempt runs (reroll cycles it). */
    variant?: number;
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
// Two primary variants per category. Variant 0 is the canonical proof; variant
// 1 is an equivalent-effort alternate — the "reroll" a stuck or bored player
// can ask for (attempt++, fresh baselines, so rerolling is never a shortcut).
const TRIAL_TEMPLATES: Record<LegacyCategory, ReadonlyArray<ReadonlyArray<TrialObjective>>> = {
    ninjutsu: [
        [{ stat: 'ninjutsuKills', delta: 12 }],
        [{ stat: 'ninjutsuDamage', delta: 9000 }],
    ],
    genjutsu: [
        [{ stat: 'genjutsuKills', delta: 12 }],
        [{ stat: 'genjutsuDamage', delta: 7000 }],
    ],
    taijutsu: [
        [{ stat: 'taijutsuKills', delta: 12 }],
        [{ stat: 'taijutsuDamage', delta: 8000 }],
    ],
    bukijutsu: [
        [{ stat: 'bukijutsuKills', delta: 12 }],
        [{ stat: 'bukijutsuDamage', delta: 8000 }],
    ],
    pvp: [
        [{ stat: 'pvpWins', delta: 6 }],
        [{ stat: 'pvpKills', delta: 8 }],
    ],
    pve: [
        [{ stat: 'missionCompletions', delta: 10 }, { stat: 'pveKills', delta: 40 }],
        [{ stat: 'huntCompletions', delta: 6 }, { stat: 'eliteKills', delta: 10 }],
    ],
    village: [
        [{ stat: 'villageDonations', delta: 5000 }, { stat: 'warContribution', delta: 3000 }],
        // NOTE: no missionCompletions here — it is village's BIND_SECONDARY,
        // and a shared stat would be deduped out of the v1 bind trial, leaving
        // it shape-identical to awaken (verification finding).
        [{ stat: 'villageDonations', delta: 8000 }, { stat: 'sectorDefenses', delta: 1 }],
    ],
    support: [
        [{ stat: 'healingDone', delta: 15_000 }],
        [{ stat: 'shieldsApplied', delta: 20 }],
    ],
    explorer: [
        [{ stat: 'sectorDiscoveries', delta: 3 }, { stat: 'wandererQuests', delta: 2 }],
        [{ stat: 'hiddenFinds', delta: 1 }, { stat: 'wandererQuests', delta: 3 }],
    ],
    pets: [
        [{ stat: 'petExpeditions', delta: 6 }],
        [{ stat: 'petExpeditions', delta: 4 }, { stat: 'huntCompletions', delta: 3 }],
    ],
    cards: [
        [{ stat: 'cardClashWins', delta: 8 }],
        [{ stat: 'cardClashWins', delta: 6 }, { stat: 'missionCompletions', delta: 6 }],
    ],
    war: [
        [{ stat: 'warContribution', delta: 4500 }],
        [{ stat: 'raidsCompleted', delta: 8 }],
    ],
    mythic: [
        [{ stat: 'missionCompletions', delta: 12 }, { stat: 'pvpWins', delta: 6 }],
        [{ stat: 'eliteKills', delta: 12 }, { stat: 'pvpWins', delta: 5 }],
    ],
};

export const TRIAL_VARIANT_COUNT = 2;

// Per-kind mechanical signatures (design: each stage must FEEL different, not
// just cost more — depth-audit finding). Bind adds a cross-category secondary
// ("bind your path to the wider world"); Prove adds a discipline proof from
// the path's own school; the Mythic trial is the culmination and carries both.
const BIND_SECONDARIES: Record<LegacyCategory, TrialObjective> = {
    ninjutsu: { stat: 'missionCompletions', delta: 8 },
    genjutsu: { stat: 'sectorDiscoveries', delta: 2 },
    taijutsu: { stat: 'huntCompletions', delta: 4 },
    bukijutsu: { stat: 'pveKills', delta: 30 },
    pvp: { stat: 'cardClashWins', delta: 3 },
    pve: { stat: 'sectorDiscoveries', delta: 2 },
    village: { stat: 'missionCompletions', delta: 8 },
    support: { stat: 'missionCompletions', delta: 8 },
    explorer: { stat: 'huntCompletions', delta: 4 },
    pets: { stat: 'wandererQuests', delta: 2 },
    cards: { stat: 'pvpWins', delta: 2 },
    war: { stat: 'pvpWins', delta: 3 },
    mythic: { stat: 'hollowGateClears', delta: 2 },
};
const PROVE_EXTRAS: Record<LegacyCategory, TrialObjective> = {
    ninjutsu: { stat: 'eliteKills', delta: 8 },
    genjutsu: { stat: 'defensiveWins', delta: 3 },
    taijutsu: { stat: 'damageBlocked', delta: 6000 },
    bukijutsu: { stat: 'sameRankWins', delta: 2 },
    pvp: { stat: 'sameRankWins', delta: 3 },
    pve: { stat: 'dungeonClears', delta: 2 },
    village: { stat: 'defensiveWins', delta: 3 },
    support: { stat: 'damageBlocked', delta: 10_000 },
    explorer: { stat: 'pveKills', delta: 30 },
    pets: { stat: 'eliteKills', delta: 6 },
    cards: { stat: 'sameRankWins', delta: 2 },
    war: { stat: 'warPvpKills', delta: 4 },
    mythic: { stat: 'bossContribution', delta: 40_000 },
};

const RARITY_FACTOR: Record<LegacyRarity, number> = { basic: 1, rare: 1.75, legendary: 3, mythic: 4.5 };
const KIND_FACTOR: Record<TrialKind, number> = { awaken: 1, bind: 1.5, prove: 2.5, mythic: 4 };
// Secondaries scale gentler than the primary — they add BREADTH to a stage,
// not a second mountain (the primary already carries the kind's full weight).
const SECONDARY_KIND_FACTOR: Record<TrialKind, number> = { awaken: 0, bind: 1, prove: 1.25, mythic: 1.75 };

export function trialObjectivesFor(def: LegacyDef, kind: TrialKind, variant = 0): TrialObjective[] {
    const factor = RARITY_FACTOR[def.rarity] * KIND_FACTOR[kind];
    const templates = TRIAL_TEMPLATES[def.category];
    const primary = templates[((variant % templates.length) + templates.length) % templates.length];
    const out: TrialObjective[] = primary.map((t) => ({
        stat: t.stat,
        delta: Math.max(1, Math.round(t.delta * factor)),
    }));
    const secondaryFactor = RARITY_FACTOR[def.rarity] * SECONDARY_KIND_FACTOR[kind];
    const addSecondary = (o: TrialObjective) => {
        if (out.some((existing) => existing.stat === o.stat)) return;
        out.push({ stat: o.stat, delta: Math.max(1, Math.round(o.delta * secondaryFactor)) });
    };
    if (kind === 'bind' || kind === 'mythic') addSecondary(BIND_SECONDARIES[def.category]);
    if (kind === 'prove' || kind === 'mythic') addSecondary(PROVE_EXTRAS[def.category]);
    return out;
}

/** Which trial kind moves a player at `stage` forward, or null if none does. */
export function nextTrialKind(stage: number): TrialKind | null {
    if (stage === 1) return 'awaken';
    if (stage === 2) return 'bind';
    if (stage === 3) return 'prove';
    if (stage === 4) return 'mythic';
    return null;   // stage 5 is the summit
}

// ── Trial narrative (depth-audit finding: the offer had a full VN, the trials
// had a progress bar). The Sage's voice per trial KIND composes with a per-
// CATEGORY clause, so all 52 kind×category intros read distinctly while the
// authored surface stays maintainable. Server-authored so the panel, the
// emissary dialog, and any future VN all speak identical canon. ──────────────
const KIND_OPENERS: Record<TrialKind, string> = {
    awaken: 'The path you chose has been carrying you. Now it asks you to carry it. This first trial is not a test of strength — it is the path learning the sound of your footsteps.',
    bind: 'A legacy held loosely is a borrowed coat. The Binding asks more: take your path out into the wider world and let the world see you wearing it, until the two of you cannot be told apart.',
    prove: 'Many awaken. Some bind. Few prove. This trial is the difference between a shinobi who walks a path and a path that is known by its shinobi. It will ask for your discipline, not your enthusiasm.',
    mythic: 'This is the last thing I will ever ask of you. Beyond this trial there are no more trials — only the name the world will use when it tells your story. Every step you have taken was a rehearsal for these.',
};
const CATEGORY_CLAUSES: Record<LegacyCategory, string> = {
    ninjutsu: 'Let the elements answer you again — not as tools, but as witnesses.',
    genjutsu: 'Work quietly. The truest illusions are the ones history itself never notices.',
    taijutsu: 'Flesh remembers what scrolls forget. Write this one in bruises.',
    bukijutsu: 'The steel already trusts you. Show it that trust was not misplaced.',
    pvp: 'Find worthy opponents. Unworthy ones would make this easy, and easy proves nothing.',
    pve: 'The wilds and the deep places are waiting. They have opinions about you. Change them.',
    village: 'A village is a promise kept daily. Keep it where the ledgers can see.',
    support: 'Stand between, again. The ones you shield will never know the cost. I will.',
    explorer: 'Go where the maps get quiet. The horizon has been asking about you.',
    pets: 'Your companions chose you long before I did. Honor the better judge.',
    cards: 'The table reveals what battle hides. Sit down. Win anyway.',
    war: 'Wars forget soldiers and remember names. Decide which you are carrying into this.',
    mythic: 'Every arena at once — that is what a mythic path costs. That is why nobody pays it.',
};
const KIND_COMPLETIONS: Record<TrialKind, string> = {
    awaken: 'It is done. The path has opened its eyes. From today it does not follow you — it walks beside you, and it has a name.',
    bind: 'The Binding holds. What you are and what you chose are now the same thing, and the world has started to say them in one breath.',
    prove: 'Proven. Not claimed, not rumored — proven. The doubters have run out of arguments, and the title you carry has grown teeth.',
    mythic: 'There is nothing left to test. Your legacy stands at its summit, and the Hall of Legends has already begun carving. Walk slowly, shinobi. Let the world get a good look.',
};

/** The Sage's charge when a trial begins — shown by the panel, the emissary,
 *  and the trial moment screen. */
export function trialIntroFor(def: LegacyDef, kind: TrialKind): string {
    return `${KIND_OPENERS[kind]} ${CATEGORY_CLAUSES[def.category]}`;
}
/** The Sage's words when a trial completes. */
export function trialCompletionFor(kind: TrialKind): string {
    return KIND_COMPLETIONS[kind];
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
