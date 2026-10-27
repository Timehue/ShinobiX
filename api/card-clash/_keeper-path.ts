/**
 * Keeper's Path, server side: the seeded map, the opponent behind each node,
 * and the run modifiers applied to a fresh match before anyone acts.
 *
 * The run itself lives in the save (`character.keeperPath`) and moves through
 * the pure reducers in shared/keeper-path-contract.ts.
 */
import { getChronicleCard, CHRONICLE_AI_DIFFICULTY_DETAILS, type ChronicleMatch } from "../../shared/chronicle-duel.js";
import {
    KEEPER_PATH_ACTS,
    KEEPER_PATH_RESOLVE,
    KEEPER_PATH_ROWS,
    hashString,
    keeperRunModifiers,
    type KeeperDifficulty,
    type KeeperNode,
    type KeeperNodeKind,
    type KeeperOpponent,
    type KeeperRun,
} from "../../shared/keeper-path-contract.js";
import { CHRONICLE_AI_DECKS } from "./_ai-engine.js";
import { echoesEncounterById } from "./_echoes-catalog.js";

/**
 * Who stands on each act's nodes. The Echoes of War Keepers bring their own
 * hand-built decks; `ai:<difficulty>` brings a Card Hall deck. Each act's boss
 * is kept out of that act's ordinary pools so it is met once, at the end.
 */
const ACT_POOLS: readonly { fights: readonly string[]; elites: readonly string[]; boss: string }[] = [
    { fights: ["echoes-1-tovin", "echoes-2-vetta", "echoes-3-aya", "ai:easy"], elites: ["echoes-4-ansel", "ai:medium"], boss: "echoes-5-sela" },
    { fights: ["echoes-4-ansel", "echoes-6-korin", "ai:medium", "echoes-3-aya"], elites: ["echoes-7-nima", "ai:hard"], boss: "echoes-8-eren" },
    { fights: ["echoes-7-nima", "echoes-9-lyra", "ai:hard", "echoes-6-korin"], elites: ["echoes-9-lyra", "echoes-8-eren"], boss: "echoes-10-halden" },
];

/** A Keeper's Path duel's run binding, kept beside (and longer than) its
 *  2-hour session, so a duel left to expire is still charged to its run. */
export const keeperMatchBindingKey = (matchId: string) => `cc-keeper-match:${matchId}`;
export const KEEPER_MATCH_BINDING_TTL_SECONDS = 7 * 24 * 60 * 60;

const PATH_KEEPER_NAMES: Record<KeeperDifficulty, string> = { easy: "Path Warden", medium: "Path Sentinel", hard: "Path Arbiter" };

export function keeperOpponent(key: string): KeeperOpponent | null {
    const echoes = echoesEncounterById(key);
    if (echoes) return { key, name: echoes.name, title: echoes.title, deckName: echoes.deckName, difficulty: echoes.difficulty };
    const difficulty = key.startsWith("ai:") ? key.slice(3) as KeeperDifficulty : null;
    if (!difficulty || !(difficulty in CHRONICLE_AI_DECKS)) return null;
    return { key, name: PATH_KEEPER_NAMES[difficulty], title: "Keeper of the Path", deckName: CHRONICLE_AI_DIFFICULTY_DETAILS[difficulty].deckName, difficulty };
}

/** The deck behind an opponent key, copied so a match can shuffle it. */
export function keeperOpponentDeck(key: string): string[] | null {
    const echoes = echoesEncounterById(key);
    if (echoes) return [...echoes.deck];
    const difficulty = key.startsWith("ai:") ? key.slice(3) : "";
    const deck = (CHRONICLE_AI_DECKS as Record<string, readonly string[]>)[difficulty];
    return deck ? [...deck] : null;
}

function sampler(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Links from node `index` of a row of `size` into a row of `nextSize`: the nodes at or beside its relative position. */
function rowLinks(index: number, size: number, nextSize: number): number[] {
    const at = size > 1 ? index / (size - 1) : .5;
    return Array.from({ length: nextSize }, (_, j) => j)
        .filter((j) => Math.abs(at - (nextSize > 1 ? j / (nextSize - 1) : .5)) <= .51);
}

/**
 * Three acts of three rows (two or three nodes each) and a boss. The first row
 * of every act is all fights; later rows always keep one Shrine and at least
 * one fight. Deterministic per seed, so a reload draws the same map.
 */
export function generateKeeperMap(seed: number): KeeperNode[] {
    const rand = sampler(seed ^ hashString("keeper-path"));
    const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
    const nodes: KeeperNode[] = [];
    for (let act = 0; act < KEEPER_PATH_ACTS; act++) {
        const pool = ACT_POOLS[act];
        const sizes = Array.from({ length: KEEPER_PATH_ROWS }, () => (rand() < .5 ? 2 : 3));
        const rows: KeeperNode[][] = sizes.map((size, row) => {
            const kinds: KeeperNodeKind[] = Array.from({ length: size }, () => "fight");
            if (row > 0) {
                kinds[Math.floor(rand() * size)] = "shrine";
                const others = kinds.map((kind, i) => (kind === "fight" ? i : -1)).filter((i) => i >= 0);
                if (others.length > 1 && rand() < .6) kinds[pick(others)] = "elite";
            }
            return kinds.map((kind, index) => {
                const key = kind === "elite" ? pick(pool.elites) : kind === "fight" ? pick(pool.fights) : null;
                const opponent = key ? keeperOpponent(key) ?? undefined : undefined;
                return { id: `a${act}r${row}n${index}`, act, row, index, kind, ...(opponent ? { opponent } : {}), links: [] };
            });
        });
        const boss: KeeperNode = { id: `a${act}boss`, act, row: KEEPER_PATH_ROWS, index: 0, kind: "boss", opponent: keeperOpponent(pool.boss) ?? undefined, links: [] };
        rows.forEach((row, r) => {
            const next = rows[r + 1];
            for (const node of row) node.links = next ? rowLinks(node.index, row.length, next.length).map((j) => next[j].id) : [boss.id];
        });
        nodes.push(...rows.flat(), boss);
    }
    // Each boss leads into the next act's first row.
    for (let act = 0; act < KEEPER_PATH_ACTS - 1; act++) {
        const boss = nodes.find((node) => node.id === `a${act}boss`)!;
        boss.links = nodes.filter((node) => node.act === act + 1 && node.row === 0).map((node) => node.id);
    }
    return nodes;
}

export function newKeeperRun(runId: string, seed: number, deck: string[], now: number): KeeperRun {
    return {
        runId, seed, nodes: generateKeeperMap(seed), position: null, current: null,
        resolve: KEEPER_PATH_RESOLVE, boons: {}, boonOffer: null, status: "active",
        deck: [...deck], wins: 0, battleProofs: [], startedAt: now,
    };
}

/**
 * Apply the run's boons to a fresh match, before the first decision. The
 * player is always p1. Each change is written into the duel log so the board
 * says why the numbers differ.
 */
export function applyKeeperModifiers(state: ChronicleMatch, boons: KeeperRun["boons"]): void {
    const mods = keeperRunModifiers(boons);
    const lines: string[] = [];
    if (mods.playerLifeBonus > 0) {
        state.p1.lifePoints += mods.playerLifeBonus;
        lines.push(`Deep Reserve: ${state.p1.name} starts with ${mods.playerLifeBonus.toLocaleString("en-US")} more life.`);
    }
    if (mods.keeperLifePenalty > 0) {
        state.p2.lifePoints = Math.max(1_000, state.p2.lifePoints - mods.keeperLifePenalty);
        lines.push(`Worn Keeper: ${state.p2.name} starts with ${mods.keeperLifePenalty.toLocaleString("en-US")} less life.`);
    }
    if (mods.vanguard) {
        let best = -1;
        let strongest = -1;
        state.p1.deck.forEach((id, index) => {
            const card = getChronicleCard(id);
            if (card?.cardClass === "monster" && card.attack > strongest) {
                strongest = card.attack;
                best = index;
            }
        });
        if (best >= 0) {
            const [card] = state.p1.deck.splice(best, 1);
            state.p1.hand.push(card);
            lines.push(`Vanguard: ${state.p1.name}'s strongest Monster starts in hand.`);
        }
    }
    for (let i = 0; i < mods.extraOpeningCards && state.p1.deck.length > 0; i++) state.p1.hand.push(state.p1.deck.shift()!);
    if (mods.extraOpeningCards > 0) lines.push(`Foresight: ${state.p1.name} draws ${mods.extraOpeningCards} more opening card${mods.extraOpeningCards === 1 ? "" : "s"}.`);
    if (lines.length) state.log = [...state.log, ...lines];
}
