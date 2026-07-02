"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.legacyAcceptedKey = exports.legacyTrialKey = void 0;
exports.trialObjectivesFor = trialObjectivesFor;
exports.nextTrialKind = nextTrialKind;
exports.trialProgress = trialProgress;
const legacyTrialKey = (player) => `legacy:trial:${player}`;
exports.legacyTrialKey = legacyTrialKey;
const legacyAcceptedKey = (player) => `legacy:accepted:${player}`;
exports.legacyAcceptedKey = legacyAcceptedKey;
/** Per-category trial templates: the stat(s) a trial re-proves, with the delta
 *  a BASIC-rarity awaken trial demands. Rarity and stage scale from here. */
// Every template stat here MUST have a live server-side write path (enforced
// by the dead-stat lint in _legacy-defs.test.ts) — a trial objective over a
// stat nothing increments would strand the player at their current stage
// FOREVER, because a legacy can never be exchanged (verification finding).
const TRIAL_TEMPLATES = {
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
const RARITY_FACTOR = { basic: 1, rare: 1.75, legendary: 3, mythic: 4.5 };
const BIND_FACTOR = 1.5;
function trialObjectivesFor(def, kind) {
    const factor = RARITY_FACTOR[def.rarity] * (kind === 'bind' ? BIND_FACTOR : 1);
    return TRIAL_TEMPLATES[def.category].map((t) => ({
        stat: t.stat,
        delta: Math.max(1, Math.round(t.delta * factor)),
    }));
}
/** Which trial kind moves a player at `stage` forward, or null if none does. */
function nextTrialKind(stage) {
    if (stage === 1)
        return 'awaken';
    if (stage === 2)
        return 'bind';
    return null; // stages 4-5 (Proven/Mythic) arrive in a later wave
}
function trialProgress(trial, stats) {
    return trial.objectives.map((o) => {
        const base = Number(trial.baselines[o.stat] ?? 0);
        const now = Number(stats[o.stat] ?? 0);
        const progress = Math.max(0, Math.floor(now - base));
        return { ...o, progress: Math.min(progress, o.delta), done: progress >= o.delta };
    });
}
