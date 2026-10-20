import { kv } from '../_storage.js';
import { lifeSceneView,parseLifeState,lifeStorageKey } from '../../shared/sector-life.js';
import { sealLifeWitnesses } from '../../shared/sector-life-witness.js';
import { shrineForSector } from '../../shared/shrines.js';
import { shrineKey } from '../sector/_traces.js';
import { lifeEnvironment } from '../sector/_life-environment.js';
import type { SectorWeatherOverride } from '../../shared/sector-weather.js';
import type { DuelGround } from './_duel-ground.js';
import {refreshChronicleStop} from '../sector/_life-chronicle.js';

/** Cosmetic snapshots cannot veto battle admission. No viewer-supplied cast,
 * observer ids, weather or later winner position participates in this seal. */
export async function withDuelWitnesses(ground:DuelGround|undefined,now:number):Promise<DuelGround|undefined> {
    if(!ground)return;
    const site={sector:ground.sector,tile:ground.tile};
    try {
        const shrine=shrineForSector(ground.sector);
        const [raw,territory,offerings]=await Promise.all([kv.get(lifeStorageKey(ground.sector)),kv.get<SectorWeatherOverride>(`world:territory:${ground.sector}`),shrine?kv.get(shrineKey(shrine.id)):null]);
        const state=parseLifeState(raw,now),environment=lifeEnvironment(ground.sector,state,now,territory,offerings);
        const scene=await refreshChronicleStop(lifeSceneView(ground.sector,state,now,environment.weather,undefined,undefined,environment.memory),now,environment.weather);
        const witnesses=sealLifeWitnesses(ground.sector,ground.tile,scene.actors,now);
        return witnesses.length?{...site,witnesses}:site;
    }catch{return site;}
}
