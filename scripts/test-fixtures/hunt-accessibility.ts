
import { STAT_KEYS, earnedForLevel, allocatedStatPoints } from '../../api/_xp-engine.js';
import { jutsuLevelCapForLevel, statCapForLevel } from '../../api/combat-core/formulas.js';
import { huntMissionById } from '../../api/missions/_mission-catalog.js';
import { builtinAiProfile } from '../../api/_ai-profile-catalog.js';
import { relevelAiProfile, type RelevelableProfile } from '../../api/_ai-level-curves.js';
import { buildSoloPveAiEncounter } from '../../api/solo-pve/_ai-encounter.js';
import { attachHuntCombat } from '../../api/solo-pve/_hunt-combat.js';
import { balanceSave } from './hunt-shrine.js';

export type Build='balanced-nin'|'focused-nin'|'focused-gen'|'matched-gen-six';
export function saveFor(level:number,build:Build,gear='robe',developing=false) {
    const save=balanceSave(level,false,true),budget=earnedForLevel(level);
    const weights=Object.fromEntries(STAT_KEYS.map(k=>[k,1]));
    if(build!=='balanced-nin' && build!=='matched-gen-six') {
        const offense=build==='focused-gen'?'genjutsuOffense':'ninjutsuOffense';
        weights.intelligence=3;weights[offense]=3;weights.willpower=1.5;
    }
    const total=Object.values(weights).reduce((a,b)=>a+b,0);
    save.character.stats=Object.fromEntries(STAT_KEYS.map(k=>[k,10+Math.floor(budget*weights[k]/total)]));
    if(build==='matched-gen-six') {
        const rest=budget-(640-10)-(570-10);
        for(const k of STAT_KEYS) save.character.stats[k]=10+Math.floor(rest/10);
        save.character.stats.intelligence=640;save.character.stats.genjutsuOffense=570;
    }
    const cap=statCapForLevel(level);
    for(const k of STAT_KEYS) save.character.stats[k]=Math.min(cap,save.character.stats[k]);
    let left=budget-allocatedStatPoints(save.character.stats);
    for(let i=0;left>0;i++) {
        const k=STAT_KEYS[i%STAT_KEYS.length]!;
        if(build==='matched-gen-six'&&(k==='intelligence'||k==='genjutsuOffense')) continue;
        if(save.character.stats[k]<cap) {save.character.stats[k]++;left--;}
    }
    const attacks=build==='focused-gen'
        ? ['starter-gen-lightning-2','starter-gen-water-2']
        : ['starter-nin-lightning-2','starter-nin-fire-2','starter-nin-water-2','starter-nin-earth-2'];
    save.character.specialty=build==='focused-gen'||build==='matched-gen-six'?'Genjutsu':'Ninjutsu';
    if(build!=='matched-gen-six') save.character.equippedJutsuIds=[...attacks,'starter-tai-earth-1','starter-universal-flicker'];
    save.character.jutsuMastery=save.character.equippedJutsuIds.map(jutsuId=>({jutsuId,level:developing?Math.min(10,jutsuLevelCapForLevel(level)):jutsuLevelCapForLevel(level)}));
    if(gear==='reinforced') {
        save.character.equipment={head:'leather-headband',body:'reinforced-vest',legs:'padded-leggings',feet:'shinobi-boots',waist:'leather-belt'} as typeof save.character.equipment;
        save.character.inventory=Object.values(save.character.equipment);
    }
    if(allocatedStatPoints(save.character.stats)!==budget) throw new Error('Progression budget mismatch');
    if(Object.values(save.character.stats).some(s=>s>cap)) throw new Error('Raw rank stat cap exceeded');
    return save;
}
export function encounter(level:number,build:Build,missionId:string,seed:number,legacy:boolean,gear='robe',developing=false) {
    const mission=huntMissionById(missionId)!,base=builtinAiProfile(mission.aiProfileId!)!;
    const profile=relevelAiProfile(base as unknown as RelevelableProfile,level,0);
    const s=buildSoloPveAiEncounter({sessionId:'accessibility',playerName:'fixture',save:saveFor(level,build,gear,developing),
        profile:profile as unknown as {id:string},now:1000,admin:null,difficultyMode:'AI_FIGHT',
        encounter:{kind:'world-ai',id:missionId},environment:{biome:'forest'}});
    attachHuntCombat(s,{kind:'hunt-target',sourceId:missionId,missionId,huntRunId:`accessibility-${seed}`,
        sector:mission.targetSector,stage:0,displayName:s.enemy.name,huntFormation:{version:1,kind:'single',count:1}});
    if(legacy) for(const a of s.huntCombat!.battle.actors) delete a.character.huntAiPolicy;
    return s;
}
