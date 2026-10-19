import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHollowGateProfile, buildHollowGateSoloPveEncounter } from './_encounter.js';
import { createHollowGateCombatBinding } from './_combat-session.js';
import type { HollowGateRunToken } from './_run-token.js';
import { balanceSave } from '../../scripts/test-fixtures/hunt-shrine.js';
import { runSoloPveAiUntilPlayer } from '../solo-pve/_engine.js';

function params(level=100,kind:'battle'|'ambush'|'elite'|'boss'|'beast'='battle',node=8) {
    const run:HollowGateRunToken={playerName:'fixture',mintedAt:1,floorDepth:5,currentFloor:1,seed:'followup-route',entryCurrencies:{},offeredAugmentIds:[],chosenAugmentId:null,dailyRunOrdinal:1};
    const binding=createHollowGateCombatBinding({playerName:'fixture',token:'offline',floor:1,nodeId:`floor:1:tile:${node}`,kind,runId:'variety',now:1000});
    return {binding,run,save:balanceSave(level,false),now:1000,admin:null};
}

test('new ordinary corridor nodes vary deterministic legal kits without additional scaling',()=>{
    for(const level of [31,50,100]) for(const kind of ['battle','ambush'] as const) {
        const profiles=Array.from({length:12},(_,node)=>{
            const p=params(level,kind,node);
            const profile=buildHollowGateProfile({...p,playerLevel:level});
            assert.deepEqual(buildHollowGateProfile({...structuredClone(p),playerLevel:level}),profile);
            return profile;
        });
        assert.equal(new Set(profiles.map(p=>p.loadoutId)).size,3);
        for(const p of profiles) {
            assert.equal(p.hp,profiles[0]!.hp);assert.deepEqual(p.stats,profiles[0]!.stats);
            assert.equal(p.armorRawDR,profiles[0]!.armorRawDR);
        }
    }
});

test('easy-band, elite, boss, beast and authored wanderer kits retain their roles',()=>{
    for(const level of [5,15,16,17,30]) for(const kind of ['battle','ambush'] as const) {
        const p=params(level,kind);
        assert.equal(buildHollowGateProfile({...p,playerLevel:level}).loadoutId,kind==='battle'?'hunter':'burst');
    }
    for(const [kind,kit] of [['elite','bruiser'],['boss','boss'],['beast','hunter']] as const) {
        const p=params(100,kind);
        assert.equal(buildHollowGateProfile({...p,playerLevel:100}).loadoutId,kit);
    }
    for(const [role,kit] of [['bandit','bruiser'],['night-ninja','burst'],['patrol','hunter']] as const) {
        const p=params();p.run.wanderers={'1':[{role,nodeId:p.binding.nodeId,origin:8,tile:8}]};
        assert.equal(buildHollowGateProfile({...p,playerLevel:100}).loadoutId,kit);
        assert.equal(buildHollowGateSoloPveEncounter(p).shrineAi!.healLimit,1);
    }
});

test('ordinary hunter/striker cannot heal while bruiser retains one and elite/boss two',()=>{
    for(const node of [8,20,35]) for(const kind of ['battle','ambush','elite','boss'] as const) {
        const p=params(100,kind,node),profile=buildHollowGateProfile({...p,playerLevel:100});
        const s=buildHollowGateSoloPveEncounter(p),limit=kind==='elite'||kind==='boss'?2:profile.loadoutId==='bruiser'?1:0;
        assert.equal(s.shrineAi!.healLimit,limit);
        assert.match(s.log.join('\n'),limit===0?/cannot use Basic Heal/:limit===1?/Basic Heal once/:/Basic Heal twice/);
        assert.deepEqual(structuredClone(s).shrineAi,s.shrineAi);
        if(limit!==0) continue;
        s.enemy.character.jutsu=[];s.enemy.pos=0;s.player.pos=119;
        for(const round of [3,6,9]) {
            s.round=round;s.enemy.hp=1;s.activeSide='enemy';s.ap.enemy=100;s.actionsThisTurn=0;s.cooldowns.enemy={};
            runSoloPveAiUntilPlayer(s);
            assert.equal(s.shrineAi!.healsUsed,0);
            assert.ok(!s.events.some(e=>e.actor==='enemy'&&e.action==='basicHeal'));
        }
    }
});
