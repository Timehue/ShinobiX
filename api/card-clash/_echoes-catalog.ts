/* Echoes of War — the Chronicle Showdown story campaign inside the Celestial
 * Tower. This file is the CANONICAL encounter table: floors, opponent decks,
 * AI difficulty and every Chronicle Point amount. The client mirrors names and
 * floors for display only (shinobij.client/src/data/echoes-of-war.ts); the
 * parity test in _echoes-catalog.test.ts keeps the two from drifting.
 *
 * Reward integrity: encounters are validated at ai-start (floor unlock) and
 * paid inside the ai-move settle mutation (applyEchoesVictory below), so a
 * client can never choose its reward, its opponent deck, or a floor it has
 * not reached. See docs/auth-and-anti-cheat-patterns.md.
 */
import type { ChronicleAiDifficulty } from '../../shared/chronicle-duel.js';

export interface EchoesEncounterDef {
    id: string;
    floor: number;
    /** Spoken name only — the VN resolves /portraits/<slug>.webp from it. */
    name: string;
    title: string;
    /** Board display name for the opponent's deck. */
    deckName: string;
    difficulty: ChronicleAiDifficulty;
    isBoss?: true;
    /** Exactly 40 legal card ids from the packable pool (validated by test). */
    deck: readonly string[];
}

/** Server-authoritative Chronicle Point amounts. Keep every number here. */
export const ECHOES_REWARDS = Object.freeze({
    repeatWin: 15,
    firstClearBonus: 35,
    bossFirstClearBonus: 50,
    basicPackCost: 100,
});

const d = (counts: Record<string, number>): readonly string[] =>
    Object.freeze(Object.entries(counts).flatMap(([id, n]) => Array(n).fill(id) as string[]));

export const ECHOES_ENCOUNTERS: readonly EchoesEncounterDef[] = Object.freeze([
    {
        id: 'echoes-1-tovin', floor: 1, name: 'Tovin', title: 'The Bell Keeper',
        deckName: 'The Unrung Bell', difficulty: 'easy',
        // Defense, delays, attack negation: the man who spent a collapse waiting.
        deck: d({
            'tc-07': 3, 'tc-12': 3, 'tc-17': 3, 'tc-26': 3, 'tc-51': 3, 'tc-57': 2, 'tc-58': 2, 'tc-03': 1,
            'chronicle-guard-stance': 2, 'chronicle-reinforced-vest': 2, 'chronicle-medical-salve': 2,
            'chronicle-smoke-bomb': 3, 'chronicle-wall-of-smoke': 3, 'chronicle-substitution-log': 3,
            'chronicle-explosive-tag': 3, 'chronicle-long-watch': 2,
        }),
    },
    {
        id: 'echoes-2-vetta', floor: 2, name: 'Vetta', title: 'The Grain Merchant',
        deckName: 'Grain and Ledger', difficulty: 'easy',
        // Low-cost bodies, draw, and trades: stock moved from one hand to another.
        deck: d({
            'tc-31': 3, 'tc-06': 3, 'tc-16': 3, 'tc-02': 3, 'tc-52': 2, 'tc-57': 3, 'tc-67': 3,
            'chronicle-recon-scroll': 3, 'chronicle-chakra-ledger': 3, 'chronicle-crimson-insight': 2,
            'chronicle-war-camp-feast': 2, 'chronicle-soldier-pill': 2, 'chronicle-medical-salve': 2,
            'chronicle-substitution-log': 3, 'chronicle-sealing-circle': 3,
        }),
    },
    {
        id: 'echoes-3-aya', floor: 3, name: 'Aya', title: 'The Courier',
        deckName: 'Dead Sprint', difficulty: 'easy',
        // Fast, cheap attackers pumped past their weight: speed over safety.
        deck: d({
            'tc-42': 3, 'tc-56': 3, 'tc-61': 3, 'tc-11': 3, 'tc-32': 3, 'tc-37': 3, 'tc-27': 2,
            'chronicle-soldier-pill': 3, 'chronicle-foxfire-feint': 3, 'chronicle-bannerlords-rally': 2,
            'chronicle-tempered-kunai': 3, 'chronicle-flame-tempered-blade': 2, 'chronicle-recon-scroll': 1,
            'chronicle-explosive-tag': 2, 'chronicle-smoke-bomb': 2, 'chronicle-cinder-minefield': 2,
        }),
    },
    {
        id: 'echoes-4-ansel', floor: 4, name: 'Ansel', title: 'The Ledger Clerk',
        deckName: 'Amended Records', difficulty: 'medium',
        // Draw, discard, and recovery from the discard pile: numbers moved twice.
        deck: d({
            'tc-31': 3, 'tc-103': 3, 'tc-57': 3, 'tc-87': 3, 'tc-33': 3, 'tc-114': 3,
            'chronicle-crimson-insight': 2, 'chronicle-war-camp-feast': 2, 'chronicle-recon-scroll': 3,
            'chronicle-chakra-ledger': 3, 'chronicle-second-wind-recall': 2, 'chronicle-forbidden-archive': 1,
            'chronicle-stacked-scrolls': 1, 'chronicle-revival-scroll': 2,
            'chronicle-still-water-rebuttal': 3, 'chronicle-kage-archive-lock': 2, 'chronicle-counter-script-cache': 1,
        }),
    },
    {
        id: 'echoes-5-sela', floor: 5, name: 'Sela', title: 'The Healer',
        deckName: 'The Last Dose', difficulty: 'medium',
        // Healing, protection, and revival: saving one thing at the cost of another.
        deck: d({
            'tc-13': 2, 'tc-99': 3, 'tc-108': 3, 'tc-77': 3, 'tc-86': 3, 'tc-110': 1, 'tc-119': 3,
            'chronicle-medical-salve': 3, 'chronicle-healers-reserve': 3, 'chronicle-hundred-shrine-benediction': 2,
            'chronicle-cleansing-radiance': 2, 'chronicle-revival-scroll': 3, 'chronicle-deathless-recall': 1,
            'chronicle-ancestral-muster': 1, 'chronicle-second-wind-recall': 1,
            'chronicle-stone-clone-barrier': 3, 'chronicle-tidal-deflection': 3,
        }),
    },
    {
        id: 'echoes-6-korin', floor: 6, name: 'Korin', title: 'The Watch Captain',
        deckName: 'Sealed District', difficulty: 'medium',
        // Walls, seals and summons turned away at the gate: an order, followed.
        deck: d({
            'tc-43': 3, 'tc-47': 3, 'tc-121': 2, 'tc-07': 3, 'tc-12': 3, 'tc-96': 2, 'tc-30': 2,
            'chronicle-iron-root-stance': 3, 'chronicle-defiant-rampart': 2, 'chronicle-reinforced-vest': 3,
            'chronicle-sealing-circle': 3, 'chronicle-gatekeepers-rebuke': 2, 'chronicle-earthen-grave-array': 3,
            'chronicle-sand-coffin-counter': 2, 'chronicle-palm-ward': 2, 'chronicle-dust-exile': 1,
            'chronicle-final-trial-binding': 1,
        }),
    },
    {
        id: 'echoes-7-nima', floor: 7, name: 'Nima', title: 'The Archivist',
        deckName: 'The Burned Shelf', difficulty: 'hard',
        // Graveyard recursion: what she destroys keeps coming back to her hand.
        deck: d({
            'tc-33': 3, 'tc-99': 3, 'tc-110': 2, 'tc-104': 3, 'tc-51': 3, 'tc-76': 3,
            'chronicle-chakra-ledger': 3, 'chronicle-second-wind-recall': 2, 'chronicle-revival-scroll': 3,
            'chronicle-deathless-recall': 1, 'chronicle-ancestral-muster': 1, 'chronicle-grave-lantern-rite': 2,
            'chronicle-crimson-insight': 2, 'chronicle-forbidden-archive': 1, 'chronicle-stacked-scrolls': 1,
            'chronicle-recon-scroll': 1,
            'chronicle-reapers-toll': 1, 'chronicle-widespread-kunai-line': 2,
            'chronicle-still-water-rebuttal': 2, 'chronicle-kage-archive-lock': 1,
        }),
    },
    {
        id: 'echoes-8-eren', floor: 8, name: 'Eren', title: 'The Chronicle Arbiter',
        deckName: 'Signed Verdict', difficulty: 'hard',
        // Negation and counters: the opponent's plan is refused before it resolves.
        deck: d({
            'tc-50': 1, 'tc-126': 3, 'tc-97': 2, 'tc-44': 2, 'tc-87': 3, 'tc-36': 3,
            'chronicle-sealbreak-verdict': 2, 'chronicle-hundredfold-tempest': 1, 'chronicle-storm-shear': 1,
            'chronicle-moonfold-genjutsu': 2, 'chronicle-hall-of-mirrors': 2,
            'chronicle-chakra-jammer': 2, 'chronicle-counter-script-cache': 3, 'chronicle-still-water-rebuttal': 1,
            'chronicle-kage-judgment-seal': 1, 'chronicle-imperial-silence-ward': 3, 'chronicle-windless-edict': 2,
            'chronicle-sovereigns-decree': 1, 'chronicle-kage-archive-lock': 2, 'chronicle-pitfall-tag-array': 2,
            'chronicle-abyssal-pitfall': 1,
        }),
    },
    {
        id: 'echoes-9-lyra', floor: 9, name: 'Lyra', title: 'The Gate Engineer',
        deckName: 'Gate Feedback', difficulty: 'hard',
        // Big output, unstable costs: power drawn from somewhere it should not be.
        deck: d({
            'tc-45': 3, 'tc-97': 3, 'tc-106': 2, 'tc-63': 3, 'tc-81': 3, 'tc-52': 2, 'tc-72': 2,
            'chronicle-flame-tempered-blade': 3, 'chronicle-field-lightning-storm': 2, 'chronicle-foxfire-feint': 2,
            'chronicle-stormforged-senbon': 2, 'chronicle-saints-edge': 1, 'chronicle-crimson-insight': 2,
            'chronicle-thunder-cage': 1, 'chronicle-heavenfall-verdict': 1, 'chronicle-flash-burial-tag': 2,
            'chronicle-returning-cylinder-seal': 1, 'chronicle-grounding-rod-script': 2,
            'chronicle-mirror-moon-rebuttal': 1, 'chronicle-widespread-kunai-line': 2,
        }),
    },
    {
        id: 'echoes-10-halden', floor: 10, name: 'Halden', title: 'The Last Chancellor',
        deckName: 'One More Day', difficulty: 'hard', isBoss: true,
        // Board wipes, drains, and monsters that grow from the opponent's losses.
        deck: d({
            'tc-124': 2, 'tc-129': 2, 'tc-128': 2, 'tc-120': 2, 'tc-47': 3, 'tc-117': 3, 'tc-135': 3, 'tc-130': 1,
            'chronicle-executioners-mandate': 1, 'chronicle-giant-felling-edict': 1, 'chronicle-war-camp-feast': 2,
            'chronicle-stacked-scrolls': 1, 'chronicle-forbidden-archive': 1, 'chronicle-deathless-recall': 1,
            'chronicle-hundred-shrine-benediction': 2, 'chronicle-sealbreak-verdict': 1,
            'chronicle-torrential-tag-field': 1, 'chronicle-mirror-shell-counter': 1, 'chronicle-reapers-toll': 1,
            'chronicle-abyssal-pitfall': 1, 'chronicle-great-maw-seal': 1, 'chronicle-chakra-jammer': 2,
            'chronicle-counter-script-cache': 2, 'chronicle-widespread-kunai-line': 2, 'chronicle-smoke-bomb': 1,
        }),
    },
]);

const BY_ID = new Map(ECHOES_ENCOUNTERS.map((def) => [def.id, def]));

export function echoesEncounterById(id: unknown): EchoesEncounterDef | null {
    return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

export interface EchoesProgressEntry {
    wins: number;
    firstClearAt?: number;
}
export type EchoesProgress = Record<string, EchoesProgressEntry>;

/** Read the campaign record off a save character, tolerating any stored junk. */
export function echoesProgressOf(character: Record<string, unknown>): EchoesProgress {
    const raw = character.echoesOfWar;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: EchoesProgress = {};
    for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
        if (!BY_ID.has(id) || !entry || typeof entry !== 'object') continue;
        const wins = Math.max(0, Math.floor(Number((entry as { wins?: unknown }).wins) || 0));
        const at = Number((entry as { firstClearAt?: unknown }).firstClearAt);
        out[id] = { wins, ...(Number.isFinite(at) && at > 0 ? { firstClearAt: at } : {}) };
    }
    return out;
}

function floorCleared(progress: EchoesProgress, floor: number): boolean {
    const def = ECHOES_ENCOUNTERS.find((entry) => entry.floor === floor);
    return !!def && (progress[def.id]?.wins ?? 0) > 0;
}

export function echoesHighestUnlockedFloor(progress: EchoesProgress): number {
    let floor = 1;
    while (floor < ECHOES_ENCOUNTERS.length && floorCleared(progress, floor)) floor += 1;
    return floor;
}

/** Floors unlock strictly in order (EVERY floor below must be cleared, so a
 * hand-edited record with a gap opens nothing); Floor 1 is open to everyone. */
export function echoesFloorUnlocked(progress: EchoesProgress, floor: number): boolean {
    if (!Number.isInteger(floor) || floor < 1 || floor > ECHOES_ENCOUNTERS.length) return false;
    return floor <= echoesHighestUnlockedFloor(progress);
}

export interface EchoesVictorySummary {
    encounterId: string;
    floor: number;
    /** Total Chronicle Points credited (base + first-clear + boss bonus). */
    points: number;
    basePoints: number;
    firstClear: boolean;
    firstClearBonus: number;
    bossBonus: number;
    wins: number;
    balance: number;
    unlockedFloor: number | null;
}

/**
 * Pure settlement step for a validated Echoes win. Runs inside the ai-move
 * settle mutation, so the Chronicle Point credit, the progression bump and the
 * replay receipt all commit in one atomic save write.
 */
export function applyEchoesVictory(
    character: Record<string, unknown>,
    def: EchoesEncounterDef,
    now: number,
): { character: Record<string, unknown>; summary: EchoesVictorySummary } {
    const progress = echoesProgressOf(character);
    const prior = progress[def.id] ?? { wins: 0 };
    const firstClear = !prior.firstClearAt && prior.wins <= 0;
    const basePoints = ECHOES_REWARDS.repeatWin;
    const firstClearBonus = firstClear ? ECHOES_REWARDS.firstClearBonus : 0;
    const bossBonus = firstClear && def.isBoss ? ECHOES_REWARDS.bossFirstClearBonus : 0;
    const points = basePoints + firstClearBonus + bossBonus;
    const wins = prior.wins + 1;
    const nextProgress: EchoesProgress = {
        ...progress,
        [def.id]: { wins, firstClearAt: prior.firstClearAt ?? now },
    };
    const balance = Math.max(0, Math.floor(Number(character.chroniclePoints) || 0)) + points;
    const nextFloor = def.floor + 1;
    const unlockedFloor = firstClear && nextFloor <= ECHOES_ENCOUNTERS.length ? nextFloor : null;
    return {
        character: { ...character, chroniclePoints: balance, echoesOfWar: nextProgress },
        summary: {
            encounterId: def.id, floor: def.floor, points, basePoints, firstClear,
            firstClearBonus, bossBonus, wins, balance, unlockedFloor,
        },
    };
}
