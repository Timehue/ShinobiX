/*
 * Legacy progression core — trial derivation and the character.legacy shape.
 *
 * Trials are authored per identity and scaled by rarity and stage as
 * FRESH-DELTA objectives over the server-owned counters (api/_legacy-track.ts):
 * "prove it again, under our eyes". Because the counters only move through
 * server settle endpoints, a trial needs no mint-token of its own — the sealed
 * baseline in `legacy:trial:<player>` plus the single-active-trial rule is the
 * whole anti-cheat story.
 *
 * NOTE: unlike the ELIGIBILITY floors (runtime-tunable via the shared:legacy-defs
 * overlay — see _legacy-score.ts getLegacyOverlay), these trial deltas are code
 * constants in _legacy-trial-paths.ts. Retuning trial
 * difficulty currently requires a deploy. A future `overlay.trials.deltaScale`
 * could make it runtime-tunable; it is deliberately not wired yet.
 */
import type { LegacyCategory, LegacyDef, LegacyStatKey } from './_legacy-defs.js';
import { individualTrialObjectives } from './_legacy-trial-paths.js';

export type TrialKind = 'awaken' | 'bind' | 'prove' | 'mythic';
// stage 1→2 (Awakened), 2→3 (Bound), 3→4 (Proven), 4→5 (Mythic)

export type TrialObjective = { stat: LegacyStatKey; delta: number };

export type LegacyTrial = {
    /** Server-issued attempt identity. Completion clients echo this so a stale
     * tab can never settle a newer trial, and a lost response can replay the
     * exact committed receipt after the active trial has been removed. */
    id?: string;
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

export type LegacyAcceptanceReceipt = {
    id: string;
    legacyId: string;
    committedAt: number;
    auraStones: number;
    chronicleCards: string[];
};

export type LegacyTrialCompletionReceipt = {
    id: string;
    legacyId: string;
    kind: TrialKind;
    trialStartedAt: number;
    attempt: number;
    completedAt: number;
    stage: 2 | 3 | 4 | 5;
    title: string | null;
    completion: string;
    chronicleCards: string[];
    signatureJutsu?: { id: string; name: string };
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
    /** The World Era (number, 1-5) this legacy was taken up in — stamped once at
     *  accept, permanent. Pins a personal accomplishment to the world timeline
     *  ("taken up in the Age of Village Dominion"). Absent on legacies accepted
     *  before this shipped. */
    eraBorn?: number;
    /** Titles granted by this legacy (also appended to earnedTitles). */
    titles: string[];
    /** Written in the same save commit as the Aura Stone balance increase.
     * This is the exact-once authority; external NX markers are legacy-only
     * migration hints and are never created by the accept path. */
    acceptanceReceipt?: LegacyAcceptanceReceipt;
    /** Four lifetime stage receipts. They are intentionally permanent: the
     * completion endpoint can replay a success after an arbitrarily lost
     * response and resume its durable world-effect outbox. */
    trialCompletionReceipts?: LegacyTrialCompletionReceipt[];
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

export function legacyTrialReceiptId(trial: Pick<LegacyTrial, 'id' | 'legacyId' | 'kind' | 'startedAt' | 'attempt'>): string {
    return trial.id?.trim()
        || `${trial.legacyId}:${trial.kind}:${Math.max(0, Math.floor(trial.startedAt))}:${Math.max(1, Math.floor(trial.attempt))}`;
}

/** Both identity-owned routes use fresh deltas from live, repeatable deeds. */
export const TRIAL_VARIANT_COUNT = 2;

export function trialObjectivesFor(def: LegacyDef, kind: TrialKind, variant = 0): TrialObjective[] {
    return individualTrialObjectives(def, kind, variant);
}

const PVP_TRIAL_STATS = new Set<LegacyStatKey>(['pvpWins', 'pvpKills', 'rankedWins', 'higherLevelWins', 'sameRankWins', 'comebackWins', 'bestKillStreak', 'defensiveWins', 'sectorDefenses', 'warPvpKills']);

/** Activity families shown before the permanent choice; no private floors. */
export function legacyTrialActivities(def: LegacyDef): string[] {
    const families = new Set<string>();
    for (const kind of ['awaken', 'bind', 'prove', 'mythic'] as const) {
        for (let variant = 0; variant < TRIAL_VARIANT_COUNT; variant++) {
            for (const { stat } of trialObjectivesFor(def, kind, variant)) {
                families.add(PVP_TRIAL_STATS.has(stat) ? 'player battles'
                    : stat === 'towerClears' || stat === 'towerCleanClears' || stat === 'towerParClears' || stat === 'towerMechanicClears' ? 'Battle Towers'
                    : stat === 'riftQuests' ? 'Rift quests'
                    : stat === 'gatheringClaims' ? 'gathering, Fishing and Mining'
                    : stat === 'craftsCompleted' ? 'item forging'
                    : stat === 'professionActions' ? 'profession work'
                    : stat === 'clanBossOperations' ? 'Clan Boss operations'
                    : stat === 'dungeonClears' || stat === 'hollowGateClears' ? 'dungeons'
                    : stat === 'cardClashWins' ? 'Card Clash'
                    : stat === 'petExpeditions' ? 'pet expeditions'
                    : stat === 'villageDonations' ? 'village donations'
                    : stat === 'warContribution' || stat === 'raidsCompleted' ? 'village raids and wars'
                    : stat === 'sectorDiscoveries' || stat === 'wandererQuests' || stat === 'hiddenFinds' ? 'exploration and Wanderer quests'
                    : 'PvE combat and missions');
            }
        }
    }
    return [...families];
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
    awaken: 'Choosing a path was the easy part. Now you earn it. This first trial is not about strength. It asks you to do this work again and again, where other people can see you do it.',
    bind: 'Plenty of shinobi try a path for a season and then drop it. The Binding asks more. Take your path out into the wider world and keep at it until people know you by it.',
    prove: 'Many shinobi awaken a path. Some bind it. Few prove it. This trial takes steady discipline over a long stretch, not one good day.',
    mythic: 'This is the last thing I will ask of you. After this trial there are no more. What remains is the story people will tell about you, so make this one count.',
};
const CATEGORY_CLAUSES: Record<LegacyCategory, string> = {
    ninjutsu: 'Win with your elements again, and let people see how you use them.',
    genjutsu: 'Work quietly. The best illusions are the ones nobody notices until it is over.',
    taijutsu: 'Scrolls will not teach you this. Expect to take some hits.',
    bukijutsu: 'You already know your weapons. Show everyone else that you do.',
    pvp: 'Find worthy opponents. Weak ones would make this easy, and easy proves nothing.',
    pve: 'The wilds and the deep places are dangerous. Go into them anyway, and come back.',
    village: 'A village runs on work people do every day. Do yours where it gets recorded.',
    support: 'Protect people again. The ones you shield may never know what it cost you. I will.',
    explorer: 'Go where the maps run out of detail, and see what is out there.',
    pets: 'Your companions trusted you before I ever did. Do right by them.',
    cards: 'A card table shows things a fight can hide. Sit down and win there too.',
    war: 'Most soldiers who fight in a war are forgotten. Decide what you want to be remembered for.',
    mythic: 'A mythic path asks for results in every arena at once. That is why almost nobody finishes one.',
};
const KIND_COMPLETIONS: Record<TrialKind, string> = {
    awaken: 'It is done. Your path is awakened. People have seen what you did, and they have started to call it by its name.',
    bind: 'The Binding holds. People no longer talk about you and your path separately. When they mention one, they mean the other.',
    prove: 'It is proven now, not just claimed or rumored. The doubters have nothing left to argue, and your title carries real weight.',
    mythic: 'There is nothing left to test. Your legacy stands at its summit, and the Hall of Legends has already started carving your name. Walk slowly, shinobi. Let people get a good look.',
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
