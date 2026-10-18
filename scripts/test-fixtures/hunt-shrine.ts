/** Deterministic offline fixtures. These are illustrative builds, not player-save replicas. */
import { builtinAiProfile } from '../../api/_ai-profile-catalog.js';
import { relevelAiProfile, type RelevelableProfile } from '../../api/_ai-level-curves.js';
import { STAT_KEYS, maxHpForLevel, maxChakraForLevel, maxStaminaForLevel } from '../../api/_xp-engine.js';
import { jutsuLevelCapForLevel } from '../../api/combat-core/formulas.js';
import { hexDistance, hexNeighbors } from '../../api/combat-core/grid.js';
import { buildHollowGateSoloPveEncounter } from '../../api/hollow-gate/_encounter.js';
import { createHollowGateCombatBinding, type HollowGateCombatKind } from '../../api/hollow-gate/_combat-session.js';
import type { HollowGateRunToken } from '../../api/hollow-gate/_run-token.js';
import { huntMissionById } from '../../api/missions/_mission-catalog.js';
import { buildSoloPveAiEncounter } from '../../api/solo-pve/_ai-encounter.js';
import { attachHuntCombat } from '../../api/solo-pve/_hunt-combat.js';
import { applySoloPveAction } from '../../api/solo-pve/_engine.js';
import type { SoloPveAction, SoloPveJutsu, SoloPveSession } from '../../api/solo-pve/_session.js';
import type { HuntFormation } from '../../shared/hunt-combat.js';

export function balanceSave(level: number, sustain: boolean) {
    const ids = ['starter-gen-wind-2','starter-gen-lightning-2','starter-gen-water-2','starter-gen-earth-2',
        ...(sustain ? ['starter-gen-wind-3','starter-nin-fire-1','starter-tai-water-3'] : ['starter-gen-fire-2','starter-nin-fire-2','starter-tai-earth-1']),
        'starter-universal-flicker'];
    const stat = level === 17 ? 400 : Math.min(2500,Math.max(35,Math.round(2500*level/100)));
    const stats = Object.fromEntries(STAT_KEYS.map(key=>[key,stat]));
    if(level===17) {stats.intelligence=640;stats.genjutsuOffense=570;}
    const equipment=level>=40?{head:'bulwark-crown',body:'bulwark-chest',hand:'bulwark-gloves',legs:'bulwark-legs',feet:'bulwark-feet',waist:'bulwark-waist'}:{body:'cloth-robe'};
    return {character:{name:'Fixture',level,specialty:'Genjutsu',stats,
        hp:maxHpForLevel(level),maxHp:maxHpForLevel(level),chakra:maxChakraForLevel(level),maxChakra:maxChakraForLevel(level),
        stamina:maxStaminaForLevel(level),maxStamina:maxStaminaForLevel(level),
        equipment,inventory:Object.values(equipment),
        equippedJutsuIds:ids,jutsuMastery:ids.map(jutsuId=>({jutsuId,level:jutsuLevelCapForLevel(level)}))}};
}

export function huntFixture(level:number, missionId:string, sustain=false, legacy=false, formation:HuntFormation={version:1,kind:'single',count:1}) {
    const mission=huntMissionById(missionId)!;
    const base=builtinAiProfile(mission.aiProfileId!)!;
    const profile=relevelAiProfile(base as unknown as RelevelableProfile,level,0);
    const s=buildSoloPveAiEncounter({sessionId:'balance-hunt',playerName:'fixture',save:balanceSave(level,sustain),
        profile:profile as unknown as {id:string},now:1000,admin:null,difficultyMode:'AI_FIGHT',
        encounter:{kind:'world-ai',id:missionId},environment:{biome:'forest'}});
    attachHuntCombat(s,{kind:formation.kind==='single'?'hunt-target':'hunt-pack',sourceId:missionId,missionId,huntRunId:'balance-run',sector:mission.targetSector,
        stage:0,displayName:s.enemy.name,huntFormation:formation});
    if(legacy) for(const a of [...s.huntCombat!.battle.actors,...(s.huntCombat!.battle.pendingEnemyWaves??[]).flatMap(w=>w.actors)]) delete a.character.huntAiPolicy;
    return s;
}

export function shrineFixture(level:number, kind:HollowGateCombatKind, sustain=false, legacy=false, role?:'bandit'|'night-ninja'|'patrol', floor=1) {
    const nodeId=`floor:${floor}:tile:8`;
    const run:HollowGateRunToken={playerName:'fixture',mintedAt:1,floorDepth:5,currentFloor:floor,seed:'balance',entryCurrencies:{},
        offeredAugmentIds:[],chosenAugmentId:null,dailyRunOrdinal:1,
        ...(role?{wanderers:{[String(floor)]:[{role,nodeId,origin:8,tile:8}]}}:{})};
    const binding=createHollowGateCombatBinding({playerName:'fixture',token:'offline',floor,nodeId,kind,runId:'balance-shrine',now:1000});
    const s=buildHollowGateSoloPveEncounter({binding,run,save:balanceSave(level,sustain),now:1000,admin:null});
    if(legacy) {delete s.enemy.character.aiTurnPolicy;delete s.shrineAi;}
    return s;
}

export type BalanceResult={outcome:string|null;rounds:number;endHp:number;minHp:number;enemyHeals:number;enemyCasts:number;enemyMaxHp:number;playerMaxHp:number;actions:number};
export function simulateBalance(source:SoloPveSession,sustain:boolean):BalanceResult {
    let s=structuredClone(source),minHp=s.player.hp,enemyHeals=0,enemyCasts=0,actions=0;
    while(s.status==='active' && actions++<240) {
        const b=s.huntCombat?.battle;
        if(b && !b.actors.some(a=>a.side==='enemy' && a.hp>0)) {
            const next=applySoloPveAction(s,{type:'huntAction',action:{type:'wait'}});
            if(!next.applied) throw new Error(`Fixture wave transition refused: ${next.reason}`);
            s=next.session;
            minHp=Math.min(minHp,s.player.hp);
            continue;
        }
        const player=b?.actors.find(a=>a.id==='player') ?? s.player;
        const width=b?.map.width ?? 12;
        const foe=b?.actors.filter(a=>a.side==='enemy' && a.hp>0)
            .sort((a,c)=>hexDistance(player.pos,a.pos,width)-hexDistance(player.pos,c.pos,width) || a.id.localeCompare(c.id))[0] ?? s.enemy;
        const cds=b ? ('cooldowns' in player ? player.cooldowns as Record<string,number> : {}) : s.cooldowns.player;
        const ap=b?.activeAp ?? s.ap.player;
        const kit=player.character.jutsu as SoloPveJutsu[];
        const casts=kit.filter(j=>(cds[j.id] ?? 0)<=0 && Number(j.ap ?? 40)<=ap
            && player.chakra>=Number(j.chakraCost ?? 0) && player.stamina>=Number(j.staminaCost ?? 0)
            && hexDistance(player.pos,foe.pos,width)<=Number(j.range ?? 1));
        const attack=casts.find(j=>Number(j.effectPower)>0 && Number(j.ap)>=60);
        const support=sustain
            ? casts.find(j=>j.tags?.some(t=>['Lifesteal','Absorb','Reflect'].includes(t.name)
                && !player.statuses.some(s=>s.name===t.name && s.rounds>0))):undefined;
        const jutsu=support ?? attack;
        let action:SoloPveAction;
        if(jutsu) action=b ? {type:'huntAction',action:{type:'jutsu',jutsuId:jutsu.id,targetId:foe===s.enemy?'':('id' in foe?String(foe.id):'')}}
            : {type:'jutsu',jutsuId:jutsu.id};
        else if(hexDistance(player.pos,foe.pos,width)<=1 && ap>=40) action=b?{type:'huntAction',action:{type:'attack',targetId:'id' in foe?String(foe.id):''}}:{type:'basicAttack'};
        else {
            const tile=hexNeighbors(player.pos,width,b?.map.height ?? 10).filter(t=>t!==foe.pos && !(b?.map.blockedTiles ?? s.environment.blockedTiles).includes(t)
                && !b?.actors.some(a=>a.hp>0 && a.pos===t))
                .sort((a,c)=>hexDistance(a,foe.pos,width)-hexDistance(c,foe.pos,width) || a-c)[0];
            if(ap>=30 && tile!==undefined && hexDistance(tile,foe.pos,width)<hexDistance(player.pos,foe.pos,width))
                action=b?{type:'huntAction',action:{type:'move',tile}}:{type:'move',tile};
            else action=b?{type:'huntAction',action:{type:'wait'}}:{type:'wait'};
        }
        const seq=s.eventSeq;
        const next=applySoloPveAction(s,action);
        if(!next.applied) throw new Error(`Fixture refused ${JSON.stringify(action)}: ${next.reason}`);
        s=next.session;
        minHp=Math.min(minHp,s.player.hp);
        if(!b) for(const e of s.events.filter(e=>e.seq>seq && e.actor==='enemy')) {
            if(e.action==='basicHeal') enemyHeals++;
            if(e.action==='jutsu') enemyCasts++;
            minHp=Math.min(minHp,e.after.player.hp);
            if(e.after.ap.enemy<0 || e.after.enemy.chakra<0 || e.after.enemy.stamina<0) throw new Error('Illegal resource budget');
        }
    }
    if(s.huntCombat) {
        const names=s.huntCombat.battle.actors.filter(a=>a.side==='enemy').map(a=>a.name);
        enemyCasts=s.log.filter(line=>names.some(name=>line.startsWith(name+' uses '))).length;
    }
    return {outcome:s.outcome,rounds:s.round,endHp:s.player.hp,minHp,enemyHeals,enemyCasts,
        enemyMaxHp:s.enemy.maxHp,playerMaxHp:s.player.maxHp,actions};
}
