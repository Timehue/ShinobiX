import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { onlineStore } from '../_realtime/online-store.js';
import { worldPositionModel } from '../../shared/continuous-world-layout.js';
import { advanceLifeEvent, lifeEnabledSector, lifeEventView, lifeSceneView, lifeWindowAt,lifeStorageKey, parseLifeState, type LifeEventState } from '../../shared/sector-life.js';
import type { SectorWeatherOverride } from '../../shared/sector-weather.js';
import { readSectorScars } from '../_sector-scars.js';
import { shrineForSector,shrineTier } from '../../shared/shrines.js';
import { shrineKey,parseShrineState } from './_traces.js';
import { lifeEnvironment } from './_life-environment.js';
import { LIFE_COURIER_LINES } from '../../shared/sector-life-courier.js';
import { LIFE_HUNT_LINES } from '../../shared/sector-life-tracking.js';
import { refreshLifeTracking } from './_life-tracking.js';
import { readHarvestGround } from '../world/_harvest-ground.js';
import { currentWandererCooldownUntil,resolveNaturalWanderer } from './_wanderer-encounter.js';
import {wildlifeDiscovery} from '../../shared/sector-life-discovery.js';
import {refreshAnglerWork} from './_life-angler.js';
import {refreshChronicleStop} from './_life-chronicle.js';
import {DOCK_SHIPMENT_SCENARIO} from '../../shared/sector-dock-shipment.js';

async function scene(sector: number, state: LifeEventState, player: string) {
    let territory: SectorWeatherOverride | null = null;
    try { territory=await kv.get<SectorWeatherOverride>(`world:territory:${sector}`); } catch { /* The shared schedule remains available, as in combat weather sealing. */ }
    const now=Date.now();
    const shrine=shrineForSector(sector);
    const [save,scars,offerings,harvest]=await Promise.all([kv.get<{character?:Record<string,unknown>}>(`save:${player}`),readSectorScars(sector,now),shrine?kv.get(shrineKey(shrine.id)):null,readHarvestGround(sector,now)]);
    const environment=lifeEnvironment(sector,state,now,territory,offerings);
    const sceneView=await refreshChronicleStop(lifeSceneView(sector,parseLifeState(state,now),now,environment.weather,save?.character?.village,scars[0],environment.memory,scars,player),now,environment.weather);
    const groundTrail=[...(sceneView.groundTrail??[]),...harvest];
    const view={...sceneView,groundTrail,service:await refreshAnglerWork(sector,now,environment.weather),wildlife:wildlifeDiscovery(sector,now,environment.weather,sceneView.campTile,groundTrail,sceneView.actors.flatMap(actor=>[actor.restTile,actor.workTile]))};
    if(view.kind==='tracks'&&view.step===1&&view.tracker&&save?.character&&(currentWandererCooldownUntil(save.character,view.tracker.id,now)||!resolveNaturalWanderer(view.tracker.id,now,save.character,sector)))return {...view,waiting:true,action:'Tracker unavailable',description:'You have already dealt with this tracker. Another traveler may take this lead.'};
    return view;
}

/** A shared, non-economic roadside story. No inventory, reward, quest, or save mutation. */
export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    try {
        const body = req.method === 'GET' ? req.query ?? {} : typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
        const sector = Number(body.sector), player = safeName(String(body.playerName ?? ''));
        if (!Number.isInteger(sector) || !lifeEnabledSector(sector)) return res.status(400).json({ error: 'There is no roadside activity here.' });
        const identity = await authedPlayerOrAdmin(req, player);
        if (!identity || !player) return res.status(401).json({ error: 'Sign in to check the road.' });
        if (!identity.admin && identity.name !== player) return res.status(403).json({ error: 'You can only act for your own character.' });
        if (!(await enforceRateLimitKv(req, res, 'sector-life', req.method === 'GET' ? 60 : 15, 60_000, player, { strict: true }))) return;
        if (req.method === 'GET') {
            const now = Date.now(), state=await refreshLifeTracking(sector,now,player);
            return res.status(200).json({ ok: true, view: await scene(sector,state,player), serverNow: Date.now() });
        }
        const expectedWindow = Number(body.window), expectedStep = Number(body.step);
        if (!Number.isSafeInteger(expectedWindow) || !Number.isInteger(expectedStep) || expectedStep < 0 || expectedStep > 2) return res.status(400).json({ error: 'This activity has changed. Check it again.' });
        // Round identity is checked against server time, independently of storage.
        if (expectedWindow !== lifeWindowAt(Date.now())) return res.status(409).json({ error: 'The road activity has changed. Check it again.' });
        const key = lifeStorageKey(sector);
        const result = await withKvLock(key, async () => {
            const raw = await kv.get(key), now = Date.now();
            if (expectedWindow !== lifeWindowAt(now)) return { error: 'The road activity has changed. Check it again.' };
            const presence = onlineStore.get(player);
            if (!presence || presence.sector !== sector || now - presence.lastSeenAt > 30_000) return { error: 'Walk to this part of the road first.' };
            if (presence.inBattle || (presence.travelingUntil ?? 0) > now) return { error: 'Finish your current battle or journey first.' };
            const state = parseLifeState(raw, now), current = lifeEventView(sector, state, now);
            if(current.waiting)return {error:current.scenario===DOCK_SHIPMENT_SCENARIO?current.description:current.kind==='tracks'?LIFE_HUNT_LINES.pending:LIFE_COURIER_LINES.waiting};
            if(current.kind==='tracks'&&state.step>=1)return {error:LIFE_HUNT_LINES.ask};
            const model = worldPositionModel(), cursor = model.read(presence.worldPosition) ?? model.fallback(sector, presence.tile ?? 77);
            const target = model.fallback(sector, current.tile);
            if (!cursor || !target || model.distanceWithin(cursor, target, 2.4) === null) return { error: 'Move closer to the marked work point.' };
            const shrine=shrineForSector(sector),offering=current.kind==='shrine'&&state.step===2&&shrine?parseShrineState(await kv.get(shrineKey(shrine.id))):undefined;
            const supportStartedAt=offering&&shrineTier(offering.total)>0?offering.kindledAt??0:undefined;
            const next = advanceLifeEvent(sector, raw, expectedWindow, expectedStep, presence.displayName, now,supportStartedAt);
            // Progress and last upkeep share ONE atomic row, including on the
            // REST fallback which has no multi-key transaction primitive.
            if(next.changed&&!await kv.compareSet(key,raw,next.state,next.state.care||next.state.hunt?undefined:{ex:7200}))return {error:'The road activity changed. Check it again.'};
            return { ok: true, view: next.view, changed: next.changed, serverNow: now };
        }, { failClosed: true });
        if('error' in result)return res.status(409).json(result);
        return res.status(200).json({...result,view:await scene(sector,result.view,player),serverNow:Date.now()});
    } catch (error) {
        if (error instanceof SyntaxError) return res.status(400).json({ error: 'The activity request could not be read.' });
        return res.status(503).json({ error: error instanceof LockContendedError ? 'Someone else is helping here. Try again in a moment.' : 'The road activity could not be loaded. Try again.' });
    }
}
