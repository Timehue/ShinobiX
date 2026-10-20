import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { lifeWanderer, type LifeSceneView, type LifeActor } from '../../shared/sector-life.js';
import {chronicleSpectator} from '../../shared/sector-chronicle-spectators.js';
import {rememberLifeWitness} from '../../shared/sector-life-witness.js';
import {CHRONICLE_WATCH_TILES} from '../../shared/sector-chronicle-stop.js';
import { CHRONICLE_STOP_SECTOR, CHRONICLE_STOP_PAINTING, chronicleStopWindow, nextChronicleStop, chronicleStopActors, chronicleStopPlan,
    type ChronicleStopState, type StopGameView } from '../../shared/sector-chronicle-stop.js';
import { stopChronicleGame } from './_life-chronicle-game.js';

export const chronicleStopKey = 'world:chronicle-stop:42';
export function addChronicleStop(view: LifeSceneView, state: ChronicleStopState, game: StopGameView, now: number): LifeSceneView {
    const pair = chronicleStopActors(state, game, now),planned=chronicleStopActors(state,game,state.window*300_000);
    const { matchAt, cardsUntil } = chronicleStopPlan(state, game);
    const cards = now >= matchAt - 6000 && now < cardsUntil && (state.closedAt === undefined || state.closedAt >= matchAt - 6000);
    const goneAt = Math.max(...planned.map(actor => actor.hideAt!));
    const actors = view.actors.map(actor => {
        if(!['visitor:42','gen'].includes(actor.id))return actor;
        const watch=CHRONICLE_WATCH_TILES[actor.id==='gen'?1:0];
        if(view.actors.some(other=>other.id!==actor.id&&(other.restTile===watch||other.workTile===watch)))return actor;
        const next=rememberLifeWitness(chronicleSpectator(actor,state,game,goneAt,now,view.updatedAt),view.groundScars??[],now);
        return{...next,motion:next.motion,wanderer:lifeWanderer(CHRONICLE_STOP_SECTOR,next)};
    });
    // Schedule admission only while the local handover crew is off shift.
    if (actors.some(actor => actor.id.startsWith('crew:')) || actors.length + pair.length > 5) return view;
    return { ...view, ...(cards ? { painting: CHRONICLE_STOP_PAINTING, paintingUntil: cardsUntil } : {}),
        actors: [...actors, ...pair.map(actor => ({ ...actor, motion: actor.motion, wanderer: lifeWanderer(CHRONICLE_STOP_SECTOR, actor) }))] };
}
/** One cosmetic record shared by visitors. No player saves, decks, rewards,
 * Chronicle sessions, or active roadside event stages are written. */
export async function refreshChronicleStop(view: LifeSceneView, now: number, weather: string) {
    const window = chronicleStopWindow(now);
    if (view.sector !== CHRONICLE_STOP_SECTOR || window === undefined) return view;
    const game = stopChronicleGame(window);
    return withKvLock(chronicleStopKey, async () => {
        const raw = await kv.get(chronicleStopKey), next = nextChronicleStop(raw, now, weather, game)!;
        if (JSON.stringify(next) !== JSON.stringify(raw) && !await kv.compareSet(chronicleStopKey, raw, next, { ex: 86_400 })) throw new Error('The roadside match changed. Check the sector again.');
        return addChronicleStop(view, next, game, now);
    }, { failClosed: true });
}
