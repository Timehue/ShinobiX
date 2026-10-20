import { sectorExits } from './sector-links.js';
import { isWalkableTile, sectorWalkMask, pathInMask } from './sector-walk-mask.js';
import { WORLD_HOUR_MS } from './world-clock.js';
import { lifeActorPosition, lifeActivityAt, type LifePhase } from './sector-life-motion.js';
import type { LifeActor } from './sector-life.js';
import {MIDLANDS_CROP_TILES} from './sector-midlands-work.js';

export const CHRONICLE_STOP_SECTOR = 42;
export const CHRONICLE_STOP_SEATS = [110, 112] as const;
// Keep the supplier, tabletop, mats and the lower approach clear of other
// resting NPCs. Duelists enter and leave below the table rather than through it.
const TABLE_CLEARANCE = [86,87,88,89,97,98,99,100,101,102,110,111,112,113];
export const CHRONICLE_WATCH_TILES=[136,138] as const;
export const WALK_CLEARANCE=[...TABLE_CLEARANCE,...MIDLANDS_CROP_TILES,...CHRONICLE_WATCH_TILES];
export const CHRONICLE_STOP_RESERVED = [...TABLE_CLEARANCE,90,103,114,115,122,123,124,125,126,127,...CHRONICLE_WATCH_TILES] as const;
export const CHRONICLE_STOP_PAINTING = 'midlands-herb-chronicle-table-v2';
export const CHRONICLE_STOP_LINES = {
    arriving: "I'm stopping for a Chronicle match at the tea table.",
    preparing: "We're setting out the cards before we start.",
    waiting: "I'm waiting for the other traveler to reach the table.",
    playing: "We're playing Chronicle. You can watch while we finish.",
    packing: "We're putting the cards away before we leave.",
    leaving: "The cards are packed. I'm continuing along the road.",
    weather: "We're putting the cards away. This weather makes it hard to keep them dry.",
    interrupted: "We've stopped the match. I'm putting the cards away before I leave.",
    unfinished: "We're stopping here for now. We'll put the cards away before we leave.",
};
export type StopGameView = { turns: readonly { player: string; turn: number; life: readonly [number, number] }[]; winner?: string; finished: boolean };
export type ChronicleStopState = { window: number; closedAt?: number; origins?: readonly [number, number] };
const STEP = 2500, PREPARE = 6000, PACK = 6000;
export function chronicleStopPath(from:number,to:number,seat:number) {
    const mask=sectorWalkMask(CHRONICLE_STOP_SECTOR)!.map((row,y)=>[...row].map((cell,x)=>{
        const tile=y*12+x;
        return tile!==seat&&tile!==from&&tile!==to&&WALK_CLEARANCE.includes(tile)?'#':cell;
    }).join(''));
    return pathInMask(mask,from,to);
}
const paths = CHRONICLE_STOP_SEATS.map((seat, index) => {
    const exits = sectorExits(CHRONICLE_STOP_SECTOR);
    const entry = exits[index % exits.length].tile, exit = exits[(index + 1) % exits.length].tile;
    return { arriving: chronicleStopPath(entry,seat,seat)!, leaving: chronicleStopPath(seat,exit,seat)! };
});
export function chronicleStopWindow(now: number): number | undefined {
    const window = Math.floor(now / WORLD_HOUR_MS), hour = ((window % 24) + 24) % 24;
    return [0, 4, 20].includes(hour) ? window : undefined;
}
export function chronicleStopPlan(state: ChronicleStopState, game: StopGameView) {
    const start = state.window * WORLD_HOUR_MS;
    const matchAt = start + Math.max(...paths.map(path => (path.arriving.length - 1) * STEP)) + PREPARE;
    const turnMs = Math.min(8000, 150_000 / Math.max(1, game.turns.length));
    const packAt = state.closedAt ?? matchAt + Math.max(1, game.turns.length) * turnMs;
    const cardsUntil = packAt + PACK;
    return { start, matchAt, turnMs, packAt, cardsUntil };
}
/** Weather closes a shared match once. Stable polls never restart a walk and
 * clearing skies never teleport the same pair back from a departure road. */
export function nextChronicleStop(raw: unknown, now: number, weather: string, game: StopGameView): ChronicleStopState | undefined {
    const window = chronicleStopWindow(now); if (window === undefined) return;
    const old = raw as ChronicleStopState | undefined;
    const valid = old?.window === window && (old.closedAt === undefined || Number.isSafeInteger(old.closedAt) && old.closedAt >= window * WORLD_HOUR_MS && old.closedAt <= (window + 1) * WORLD_HOUR_MS && old.origins?.length === 2 && old.origins.every((tile,i) => Number.isInteger(tile) && isWalkableTile(CHRONICLE_STOP_SECTOR, tile) && (!TABLE_CLEARANCE.includes(tile)||tile===CHRONICLE_STOP_SEATS[i]) && chronicleStopPath(tile,paths[i].leaving.at(-1)!,CHRONICLE_STOP_SEATS[i])));
    const state = valid ? old : { window };
    const plan = chronicleStopPlan(state, game);
    if (state.closedAt !== undefined || now >= plan.packAt || !['rain', 'thunderstorm', 'tornado', 'ashfall'].includes(weather)) return state;
    const actors = chronicleStopActors(state, game, now), origins = CHRONICLE_STOP_SEATS.map((_, i) => {
        const actor = actors.find(a => a.id === `chronicle:${i}`);
        if (!actor) return paths[i].arriving[0];
        const pose = lifeActorPosition(CHRONICLE_STOP_SECTOR, actor, now);
        return Math.round(pose.row) * 12 + Math.round(pose.col);
    }) as [number, number];
    return { window, closedAt: now, origins };
}
export function chronicleStopActors(state: ChronicleStopState, game: StopGameView, now: number): LifeActor[] {
    const { start, matchAt, turnMs, packAt, cardsUntil } = chronicleStopPlan(state, game);
    return paths.flatMap((path, i) => {
        const origin = state.origins?.[i] ?? CHRONICLE_STOP_SEATS[i];
        const leaving = state.closedAt === undefined ? path.leaving : chronicleStopPath(origin,path.leaving.at(-1)!,CHRONICLE_STOP_SEATS[i])!;
        const goneAt = cardsUntil + (leaving.length - 1) * STEP + 1500;
        if (now >= goneAt) return [];
        const arrives = start + (path.arriving.length - 1) * STEP;
        const seat = CHRONICLE_STOP_SEATS[i], exit = leaving.at(-1)!;
        const phases: LifePhase[] = [
            { at: start, activity: 'Walking to the tea table', line: CHRONICLE_STOP_LINES.arriving },
            { at: arrives, activity: 'Waiting at the tea table', line: CHRONICLE_STOP_LINES.waiting },
            { at: matchAt - PREPARE, activity: 'Setting out Chronicle cards', line: CHRONICLE_STOP_LINES.preparing },
            ...game.turns.map((turn, index) => ({ at: matchAt + index * turnMs, activity: `Chronicle turn ${turn.turn}: ${turn.player}`,
                line: `${turn.player} is taking turn ${turn.turn}. Our life points are ${turn.life[0]} and ${turn.life[1]}.` })),
            { at: packAt, activity: 'Putting the Chronicle cards away', line: state.closedAt !== undefined ? CHRONICLE_STOP_LINES.interrupted : game.winner ? `${game.winner} won our Chronicle match. ${CHRONICLE_STOP_LINES.packing}` : game.finished ? `Our Chronicle match ended in a draw. ${CHRONICLE_STOP_LINES.packing}` : CHRONICLE_STOP_LINES.unfinished },
            { at: cardsUntil, activity: 'Continuing along the road', line: CHRONICLE_STOP_LINES.leaving },
        ].filter(phase => state.closedAt === undefined || phase.at < packAt || phase.at === packAt && phase.activity === 'Putting the Chronicle cards away' || phase.at === cardsUntil && phase.activity === 'Continuing along the road');
        const motion = state.closedAt === undefined ? { start, frames: [...path.arriving.map((tile, index) => [index * STEP, tile] as const),
            [cardsUntil - start, seat] as const, ...leaving.slice(1).map((tile, index) => [cardsUntil - start + (index + 1) * STEP, tile] as const)] }
            : { start: packAt, frames: [[0, origin] as const, ...leaving.map((tile, index) => [PACK + index * STEP, tile] as const)] };
        const base = { id: `chronicle:${i}`, name: i ? 'Traveler Sada' : 'Traveler Neri', art: i ? 'caretaker' as const : 'scribe' as const,
            tile: seat, workTile: seat, restTile: exit, hideAt: goneAt,clearance:WALK_CLEARANCE.filter(tile=>tile!==seat), motion, phases, activity: 'Playing Chronicle', line: CHRONICLE_STOP_LINES.playing };
        return [{ ...base, ...lifeActivityAt(base, now), phases }];
    });
}
