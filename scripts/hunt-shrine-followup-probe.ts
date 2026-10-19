/** Offline deterministic acceptance data; never reads or changes live saves. */
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { diagnosticPlayerSave, plannedPlayerActions } from './pve-viability-diagnostic.js';
import { applySoloPveAction } from '../api/solo-pve/_engine.js';
import type { SoloPveSession } from '../api/solo-pve/_session.js';
import { closeFixtureAudit } from './pve-close-fights-benchmark.js';
import { auditPressureFixture } from './_pve-pressure-fixture-audit.js';
import { buildWorldAiFightSpec } from '../api/missions/_world-ai-fight.js';
import { huntMissionById } from '../api/missions/_mission-catalog.js';
import { buildSoloPveAiEncounter } from '../api/solo-pve/_ai-encounter.js';
import { attachHuntCombat } from '../api/solo-pve/_hunt-combat.js';
import { createHollowGateCombatBinding } from '../api/hollow-gate/_combat-session.js';
import { buildHollowGateSoloPveEncounter } from '../api/hollow-gate/_encounter.js';
import type { HollowGateRunToken } from '../api/hollow-gate/_run-token.js';
import { simulateBalance } from './test-fixtures/hunt-shrine.js';

function plannerBalance(source: SoloPveSession) {
    let s=structuredClone(source), actions=0, minHp=s.player.hp, enemyHeals=0, enemyCasts=0, weaponUses=0;
    while(s.status==='active' && actions++<240) {
        const seq=s.eventSeq;
        const candidates=plannedPlayerActions(s);
        const accepted=candidates.map(action=>({action,result:applySoloPveAction(s,action)})).find(x=>x.result.applied);
        assert.ok(accepted,'planner must have a legal action');
        if(accepted.action.type==='weapon') weaponUses++;
        s=accepted.result.session;
        minHp=Math.min(minHp,s.player.hp);
        for(const e of s.events.filter(e=>e.seq>seq)) {
            assert.ok(e.after.ap.player>=0 && e.after.ap.enemy>=0 && e.after.enemy.chakra>=0 && e.after.enemy.stamina>=0,'legal action budgets');
            minHp=Math.min(minHp,e.after.player.hp);
            if(e.actor==='enemy' && e.action==='basicHeal') enemyHeals++;
            if(e.actor==='enemy' && e.action==='jutsu') enemyCasts++;
        }
    }
    return {outcome:s.outcome,rounds:s.round,endHp:s.player.hp,minHp,enemyHeals,enemyCasts,
        enemyMaxHp:s.enemy.maxHp,playerMaxHp:s.player.maxHp,actions,weaponUses};
}

async function main() {
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const output = process.argv[2] ?? '.tmp/hunt-shrine-followup.json';
const quick = process.argv.includes('--quick');
const levels = quick ? [15,16,17,30,50,100] : [5,15,16,17,20,30,31,50,100];
const audits: Record<string, unknown> = {}, rows: unknown[] = [];
const sources = ['api/towers/_hunt-ai.ts','api/solo-pve/_hunt-combat.ts','api/hollow-gate/_encounter.ts','api/solo-pve/_engine.ts','api/solo-pve/_session.ts'];
const sourceHashes = () => Object.fromEntries(sources.map(path => [path, hash(readFileSync(path,'utf8'))]));
const beforeHashes = sourceHashes();
for (const level of levels) {
    const builds = [
        { id: 'earned-starter', sustain: false, audit: auditPressureFixture(diagnosticPlayerSave(level,'starter','coherent','B'),level), save: diagnosticPlayerSave(level,'starter','coherent','B') },
        { id: 'earned-specialist', sustain: false, audit: auditPressureFixture(diagnosticPlayerSave(level,'offense','coherent','A'),level), save: diagnosticPlayerSave(level,'offense','coherent','A') },
        ...(level === 100 ? ['optimized','sustain'].map(id => { const audit=closeFixtureAudit(level,id); return {id:`strong-${id}`,sustain:id==='sustain',audit,save:audit.save}; }) : []),
    ];
    for (const build of builds) {
        assert.equal(build.audit.legal,true,JSON.stringify(build.audit));
        assert.equal(build.audit.acquisitionWarnings.length,0,JSON.stringify(build.audit));
        audits[`${level}:${build.id}`] = build.audit;
        for (const missionId of ['hunt-wild-boar','hunt-frost-wolf',...(quick?[]:['hunt-ash-lizard','hunt-forest-hawk'])]) {
            const mission=huntMissionById(missionId)!;
            if(level<mission.levelReq) continue;
            for(const quality of quick?[0]:[0,3]) for(const counters of [false,true]) {
                const runId=`followup-${level}-${missionId}-${quality}`;
                const save={...structuredClone(build.save),currentSector:mission.targetSector,acceptedMissionIds:[missionId]};
                Object.assign(save.character,{hunterRank:5,serverHuntTrails:{[missionId]:{missionId,runId,progress:mission.exploreCount-1,quality,acceptedAt:1}}});
                const spec=await buildWorldAiFightSpec({playerName:String(save.character.name),save,request:{kind:'hunt-target',sourceId:missionId,sector:mission.targetSector},now:1000});
                const session=buildSoloPveAiEncounter({sessionId:'followup-hunt',playerName:String(save.character.name),save,profile:spec.profile,now:1000,admin:null,difficultyMode:'AI_FIGHT',encounter:{kind:'world-ai',id:missionId},environment:spec.environment});
                attachHuntCombat(session,spec.context);
                rows.push({id:`hunt:${level}:${build.id}:${missionId}:${quality}:${counters}`,level,build:build.id,counters,quality,kind:'hunt',missionId,
                    powerHash:hash({player:session.player,enemyHp:session.enemy.maxHp,enemyStats:session.enemy.character.stats,enemyJutsu:session.enemy.character.jutsu,enemyMastery:session.enemy.character.jutsuMastery}),
                    result:simulateBalance(session,build.sustain,{useCounters:counters})});
            }
        }
        if (![5,17,50,100].includes(level)) continue;
        for(const kind of ['battle','ambush','elite','boss'] as const) for(const node of quick?[8]:[8,20,35]) {
            const floor=kind==='boss'?5:1,nodeId=`floor:${floor}:tile:${node}`;
            const run:HollowGateRunToken={playerName:String(build.save.character.name),mintedAt:1,floorDepth:5,currentFloor:floor,seed:'followup-route',entryCurrencies:{},offeredAugmentIds:[],chosenAugmentId:null,dailyRunOrdinal:1};
            const binding=createHollowGateCombatBinding({playerName:run.playerName,token:'offline',floor,nodeId,kind,runId:'followup-shrine',now:1000});
            const session=buildHollowGateSoloPveEncounter({binding,run,save:build.save,now:1000,admin:null});
            rows.push({id:`shrine:${level}:${build.id}:${kind}:${node}`,level,build:build.id,kind,node,
                powerHash:hash({player:session.player,maxHp:session.enemy.maxHp,stats:session.enemy.character.stats}),
                kit:session.enemy.character.jutsu,healLimit:session.shrineAi?.healLimit,
                result:simulateBalance(session,build.sustain,{useCounters:true}),
                ...(level===100 ? {plannerResult:plannerBalance(session)} : {})});
        }
    }
}
assert.deepEqual(sourceHashes(),beforeHashes,'runtime changed during measurement');
writeFileSync(output,JSON.stringify({sourceHashes:beforeHashes,audits,rows,limits:[
    'Offline deterministic catalog/current-forge controls; not live Buster or Rill replays, stochastic win rates, or quest acquisition proofs.',
    'Earned builds conserve normal progression budgets. Strong L100 controls include explicitly audited additional earned training and legal owned equipment.',
    'Sustain and catalog offense use different kits/gear; their difference is not a causal sustain estimate.',
    'Rotation controls do not use weapons. L100 shrine rows additionally use the real bounded own-turn planner, including legal equipped weapon effects; this remains a policy proxy.',
    'Boss row is an unchanged constructor/engine control; external Warden map hazards and dungeon attrition are excluded. No Warden tuning is justified by it.',
]},null,2)+'\n');
console.log(`Wrote ${rows.length} audited deterministic cases to ${output}`);
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/hunt-shrine-followup-probe.ts')) void main().catch(error => { console.error(error); process.exitCode=1; });
