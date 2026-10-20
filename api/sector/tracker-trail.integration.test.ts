import assert from 'node:assert/strict';
import { before, beforeEach, after, describe, it, mock } from 'node:test';
import { lifeEventView,parseLifeState,lifeStorageKey,LIFE_WINDOW_MS } from '../../shared/sector-life.js';
import { PLAYABLE_WILD_SECTOR_IDS } from '../../shared/sector-geo.js';
import { WANDERER_BUCKET_MS } from '../../shared/wanderer-roster.js';
import { worldPositionModel } from '../../shared/continuous-world-layout.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'tracker-trail-integration-secret';

/*
 * The Tracker wanderer's "Follow tracks": a server-owned two-sector trail whose
 * final sector mints a GUARANTEED wild pet into the normal wild-binding battle.
 * Runs the real handlers end to end: wanderer-service → encounter-start →
 * wild-binding, with the memory KV and live presence store.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, any> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let service: Handler;
let wildStart: Handler;
let wildBinding: Handler;
type RosterWanderer = import('../../shared/wanderer-roster.js').Wanderer;
let tracker: { w: RosterWanderer; sector: number };
let other: { w: RosterWanderer; sector: number };

before(async () => {
    const roster = await import('../../shared/wanderer-roster.js');
    // The roster is a pure function of (sector, 6h bucket). Freeze the clock on
    // the first bucket that rolls a tracker somewhere, so the suite never races
    // a bucket boundary and never depends on a lucky wall-clock window.
    let found: { now: number; tracker: typeof tracker; other: typeof other } | null = null;
    for (let bucket = 82_000; bucket < 82_400 && !found; bucket++) {
        let t: typeof tracker | null = null;
        let o: typeof other | null = null;
        for (let sector = 1; sector <= roster.WANDERER_SECTOR_COUNT; sector++) {
            for (const w of roster.rollWanderers(sector, bucket)) {
                if (!t && w.verb === 'tracker') t = { w, sector };
                else if (!o && w.verb !== 'tracker') o = { w, sector };
            }
        }
        if (t && o) found = { now: bucket * roster.WANDERER_BUCKET_MS + 60 * 60 * 1000, tracker: t, other: o };
    }
    assert.ok(found, 'a bucket with a tracker exists');
    ({ tracker, other } = found);
    mock.timers.enable({ apis: ['Date'], now: found.now });
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    service = (await import('./wanderer-service.js')).default as unknown as Handler;
    wildStart = (await import('../pet/encounter-start.js')).default as unknown as Handler;
    wildBinding = (await import('../pet/wild-binding.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    for (const player of onlineStore.list()) {
        if (player.name.startsWith('trailplayer')) onlineStore.remove(player.name);
    }
});

after(() => {
    for (const player of onlineStore.list()) {
        if (player.name.startsWith('trailplayer')) onlineStore.remove(player.name);
    }
    mock.timers.reset();
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function post(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (json: Record<string, unknown>) => { out.body = json; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { playerName, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: `127.5.0.${playerName.length}` },
    } as never, res as never);
    return out;
}

// Presence refuses to teleport a live session, so the fixture drops it and
// re-places the player, standing in for a completed /player/travel.
function standIn(playerName: string, sector: number) {
    onlineStore.remove(playerName);
    onlineStore.upsert({ name: playerName, sector, character: { name: playerName, hp: 100, maxHp: 100 } });
}

async function seedPlayer(playerName: string, sector: number) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: sector,
        character: {
            name: playerName, village: 'Leaf', level: 30, ryo: 1_000,
            hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            fateShards: 0, boneCharms: 0, inventory: [], itemStacks: [], pets: [],
        },
    });
    standIn(playerName, sector);
}

async function startTrail(playerName: string) {
    const out = await post(service, playerName, {
        action: 'tracker-trail-start', sector: tracker.sector, wandererId: tracker.w.id, wandererName: tracker.w.name,
    });
    assert.equal(out.statusCode, 200);
    assert.equal(out.body?.ok, true, JSON.stringify(out.body));
    return out.body!.trail as { id: string; requestId: string; sectors: [number, number]; step: number; giver: string };
}

describe('tracker trail', () => {
    it('only a tracker gives a trail', async () => {
        const player = 'trailplayerverb';
        await seedPlayer(player, other.sector);
        const out = await post(service, player, {
            action: 'tracker-trail-start', sector: other.sector, wandererId: other.w.id, wandererName: other.w.name,
        });
        assert.equal(out.body?.ok, false);
        assert.equal(out.body?.reason, 'invalid-wanderer');
        assert.equal(await kv.get(`tracker-trail:${player}`), null);
    });

    it('leads through two sectors to a guaranteed wild pet that enters the capture battle', async () => {
        const player = 'trailplayerfull';
        await seedPlayer(player, tracker.sector);
        const trail = await startTrail(player);
        assert.equal(trail.giver, tracker.w.name);
        assert.equal(trail.step, 0);
        const saved = await kv.get<{ character: Record<string, any> }>(`save:${player}`);
        assert.equal(saved?.character.activeTrackerTrail?.id, trail.id, 'the display mirror is written');
        assert.ok(saved?.character.wandererCooldowns?.[tracker.w.id] > Date.now(), 'the tracker moves on');

        // The pet sector refuses to mint before the tracks sector is walked.
        standIn(player, trail.sectors[1]);
        const early = await post(wildStart, player, { sector: trail.sectors[1], requestId: trail.requestId, trackerTrailId: trail.id });
        assert.equal(early.statusCode, 409);
        assert.equal(early.body?.reason, 'trail-cold');

        // The step must happen in the tracks sector.
        const wrong = await post(service, player, { action: 'tracker-trail-step', sector: trail.sectors[1], trailId: trail.id });
        assert.equal(wrong.body?.reason, 'wrong-sector');
        standIn(player, trail.sectors[0]);
        const step = await post(service, player, { action: 'tracker-trail-step', sector: trail.sectors[0], trailId: trail.id });
        assert.equal(step.body?.ok, true, JSON.stringify(step.body));
        assert.equal(step.body?.trail.step, 1);

        // The final sector always yields a pet.
        standIn(player, trail.sectors[1]);
        const hit = await post(wildStart, player, { sector: trail.sectors[1], requestId: trail.requestId, trackerTrailId: trail.id });
        assert.equal(hit.statusCode, 200, JSON.stringify(hit.body));
        assert.ok(hit.body?.token, 'a wild encounter token was minted');
        assert.ok(hit.body?.pet?.rarity, 'with a real pet');
        const replay = await post(wildStart, player, { sector: trail.sectors[1], requestId: trail.requestId, trackerTrailId: trail.id });
        assert.equal(replay.body?.token, hit.body?.token, 'a retry replays, never rerolls');

        // The trail is the battle's discovery proof. No pet owned → Guild Fox loaner.
        const battle = await post(wildBinding, player, { action: 'start', token: hit.body!.token });
        assert.equal(battle.statusCode, 200, JSON.stringify(battle.body));
        assert.ok(battle.body?.wild?.loanerPet, 'a player with no pet borrows the Guild Fox');

        // The trail cannot be abandoned out from under a live battle.
        const blocked = await post(service, player, { action: 'tracker-trail-abandon', trailId: trail.id });
        assert.equal(blocked.body?.reason, 'in-battle');

        const forfeit = await post(wildBinding, player, { action: 'forfeit', token: hit.body!.token });
        assert.equal(forfeit.statusCode, 200);
        const cleared = await post(service, player, { action: 'tracker-trail-abandon', trailId: trail.id });
        assert.equal(cleared.body?.ok, true, JSON.stringify(cleared.body));
        assert.equal(await kv.get(`tracker-trail:${player}`), null);
        const after = await kv.get<{ character: Record<string, any> }>(`save:${player}`);
        assert.equal(after?.character.activeTrackerTrail, null);
    });

    it('allows one trail at a time and refuses a forged trail id', async () => {
        const player = 'trailplayerbusy';
        await seedPlayer(player, tracker.sector);
        const trail = await startTrail(player);
        // Clear the tracker's cooldown so only the busy gate is exercised.
        const record = await kv.get<{ character: Record<string, any> }>(`save:${player}`);
        await kv.set(`save:${player}`, { ...record, character: { ...record!.character, wandererCooldowns: {}, wandererMoves: {} } });
        for (const key of await kv.keys(`wanderer-use:*`)) await kv.del(key);
        const again = await post(service, player, {
            action: 'tracker-trail-start', sector: tracker.sector, wandererId: tracker.w.id, wandererName: tracker.w.name,
        });
        assert.equal(again.body?.ok, false);
        assert.equal(again.body?.reason, 'busy');

        standIn(player, trail.sectors[1]);
        const forged = await post(wildStart, player, { sector: trail.sectors[1], requestId: trail.requestId, trackerTrailId: 'trail-forged-000000000' });
        assert.equal(forged.statusCode, 409);
        assert.equal(forged.body?.reason, 'trail-cold');
    });
});

for(const resolution of ['capture','forfeit'] as const)it(`a world tracking event follows the real ${resolution} result and returns its party without another reward`,async()=>{
    let site:{time:number;sector:number;w:RosterWanderer}|undefined;
    const bucket=Math.floor(Date.now()/WANDERER_BUCKET_MS);
    for(let round=0;round<16&&!site;round++)for(const sector of PLAYABLE_WILD_SECTOR_IDS){const time=bucket*WANDERER_BUCKET_MS+round*LIFE_WINDOW_MS+60_000,view=lifeEventView(sector,parseLifeState(null,time),time);if(view.kind==='tracks'&&view.tracker){site={time,sector,w:view.tracker};break;}}
    assert(site,'a real natural tracker offers a world trail');mock.timers.setTime(site.time);
    const previous=tracker;tracker={w:site.w,sector:site.sector};
    const player=`trailplayerworld${resolution}`,life=(await import('./life.js')).default as unknown as Handler;
    const getLife=async()=>{const out:Out={statusCode:200};const res={setHeader(){},status(code:number){out.statusCode=code;return res;},json(value:Record<string,unknown>){out.body=value;return res;},end(){return res;}};await life({method:'GET',query:{sector:site!.sector,playerName:player},headers:{'x-player-token':issuePlayerToken(player)}} as never,res as never);assert.equal(out.statusCode,200,JSON.stringify(out.body));return out.body!.view;};
    try {
        await seedPlayer(player,site.sector);const save=await kv.get<any>(`save:${player}`);await kv.set(`save:${player}`,{...save,character:{...save.character,itemStacks:[{itemId:'beast-seal-reinforced',count:1}]}});
        const first=await getLife(),present=onlineStore.get(player)!;assert(worldPositionModel().fallback(site.sector,first.tile));
        assert(onlineStore.commitWorldPosition(player,worldPositionModel().fallback(site.sector,first.tile)!,present.movementSeq??0));
        const inspect=await post(life,player,{sector:site.sector,window:first.window,step:0});assert.equal(inspect.statusCode,200);assert.equal(inspect.body?.view.step,1);
        const trail=await startTrail(player),key=lifeStorageKey(site.sector);const linked=await kv.get<any>(key);assert.equal(linked.hunt.trailId,trail.id);assert.equal(linked.step,2);
        const retry=await startTrail(player);assert.equal(retry.id,trail.id,'a lost reply recovers the same committed lead');
        const forged=await post(life,player,{sector:site.sector,window:first.window,step:2,hunt:{result:'bound'},result:'bound'});assert.equal(forged.statusCode,409);assert.equal((await kv.get<any>(key)).hunt.result,undefined);
        standIn(player,trail.sectors[0]);assert.equal((await post(service,player,{action:'tracker-trail-step',sector:trail.sectors[0],trailId:trail.id})).body?.ok,true);
        standIn(player,trail.sectors[1]);const hit=await post(wildStart,player,{sector:trail.sectors[1],requestId:trail.requestId,trackerTrailId:trail.id});assert.equal(hit.statusCode,200,JSON.stringify(hit.body));
        const token=hit.body!.token;assert.equal((await post(wildBinding,player,{action:'start',token})).statusCode,200);
        const finished=await post(wildBinding,player,resolution==='capture'?{action:'capture',token,sealId:'beast-seal-reinforced',attemptId:'worldtrailcapture0001'}:{action:'forfeit',token});assert.equal(finished.statusCode,200,JSON.stringify(finished.body));
        if(resolution==='capture')assert.equal(finished.body?.capture.success,true,'the existing first-binding tutorial gives its normal guaranteed chance');
        const beforeRefresh=await kv.get(`save:${player}`),result=await getLife();assert.equal(result.phase,'aftermath');assert.equal(result.hunt,undefined,'the public scene does not expose private trail receipt identifiers');
        const remembered=await kv.get<any>(key);assert.equal(remembered.hunt.result,resolution==='capture'?'bound':'unbound');assert.equal(result.step,3);
        assert.deepEqual(await kv.get(`save:${player}`),beforeRefresh,'world aftermath does not grant or spend anything');
        const hunter=result.actors.find((a:any)=>a.id===`hunter:${site!.sector}`);assert(hunter);const frames=hunter.motion.frames;
        const arrival=frames.find((f:number[],i:number)=>frames[i+1]?.[1]===hunter.restTile&&f[1]===hunter.restTile&&frames[i+1][0]-f[0]>=180_000);assert(arrival);
        mock.timers.setTime(remembered.hunt.startedAt+arrival[0]+1000);const rested=await getLife();assert.equal(rested.actors.find((a:any)=>a.id===hunter.id).activity,'Resting after the animal trail');
        const stable=await kv.get(key);await getLife();assert.deepEqual(await kv.get(key),stable,'re-reading cannot replay or extend the result');
    } finally {tracker=previous;}
});
