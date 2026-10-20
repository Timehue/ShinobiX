import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHollowGateProfile, buildHollowGateSoloPveEncounter } from './_encounter.js';
import { createHollowGateCombatBinding } from './_combat-session.js';
import type { HollowGateRunToken } from './_run-token.js';
import { balanceSave } from '../../scripts/test-fixtures/hunt-shrine.js';
import { runSoloPveAiUntilPlayer } from '../solo-pve/_engine.js';
import { builtinAiProfile } from '../_ai-profile-catalog.js';

function params(level=100,kind:'battle'|'ambush'|'elite'|'boss'|'beast'='battle',node=8) {
    const run:HollowGateRunToken={playerName:'fixture',mintedAt:1,floorDepth:5,currentFloor:1,seed:'followup-route',entryCurrencies:{},offeredAugmentIds:[],chosenAugmentId:null,dailyRunOrdinal:1};
    const binding=createHollowGateCombatBinding({playerName:'fixture',token:'offline',floor:1,nodeId:`floor:1:tile:${node}`,kind,runId:'variety',now:1000});
    return {binding,run,save:balanceSave(level,false),now:1000,admin:null};
}

test('every shrine shinobi encounter seals 40 rounds at creation', () => {
    for (const kind of ['battle', 'ambush', 'elite', 'boss', 'beast'] as const)
        assert.equal(buildHollowGateSoloPveEncounter(params(17, kind)).hollowGateRoundLimit, 40);
});

test('named boss honors its authored kit and opener while retaining shrine numbers at every level', () => {
    const named = builtinAiProfile('rift-boss-mirror-shard')!;
    for (const level of [5, 17, 50, 100]) {
        const p = params(level, 'boss'); p.run.bossProfileId = named.id; p.run.bossName = named.name;
        const generic = buildHollowGateSoloPveEncounter(p);
        const actual = buildHollowGateSoloPveEncounter({ ...p, namedBossProfile: named });
        assert.equal(actual.encounter.metadata?.namedBossProfileId, named.id);
        assert.deepEqual((actual.enemy.character.jutsu as Array<{ id: string }>).map(j => j.id), named.jutsuIds);
        assert.deepEqual(actual.enemy.character.aiRules, named.rules, 'the named boss retains its validated thematic script');
        for (const key of ['level', 'stats', 'armorRawDR', 'jutsuMastery', 'aiTurnPolicy'])
            if (key !== 'jutsuMastery') assert.deepEqual(actual.enemy.character[key], generic.enemy.character[key], key);
        assert.deepEqual(actual.enemy.character.jutsuMastery,
            named.jutsuIds.map(jutsuId => ({ jutsuId, level: (generic.enemy.character.jutsuMastery as Array<{ level: number }>)[0].level })));
        for (const key of ['hp', 'maxHp', 'chakra', 'maxChakra', 'stamina', 'maxStamina'] as const) assert.equal(actual.enemy[key], generic.enemy[key], key);
        assert.deepEqual(actual.shrineAi, generic.shrineAi);
        actual.activeSide = 'enemy'; actual.ap.enemy = 100; actual.enemy.pos = 27; actual.player.pos = 26;
        runSoloPveAiUntilPlayer(actual);
        const opener = actual.events.find(e => e.actor === 'enemy' && e.kind === 'action');
        const authoredOpener = named.rules.find(rule => rule.condition === 'specific_round' && rule.value === 1 && rule.action === 'use_specific_jutsu');
        if (level >= 50) assert.equal(opener?.actionId, authoredOpener?.jutsuId, 'the legal shrine runner uses the authored opener from this boss’s current kit');
        else assert.ok(opener, 'low-level policy retains its legal accessible fallback');
        assert.ok(actual.events.every(e => e.after.ap.enemy >= 0 && e.after.ap.player >= 0));
    }
});

test('missing, mismatched or unsupported named profiles keep the existing generic boss kit', () => {
    const p = params(100, 'boss'); p.run.bossProfileId = 'unknown';
    const original = buildHollowGateSoloPveEncounter(p);
    for (const namedBossProfile of [null, { id: 'different', jutsuIds: ['starter-gen-lightning-2'] },
        { id: 'unknown', jutsuIds: ['missing-technique'], rules: [] },
        { id: 'unknown', jutsuIds: ['starter-gen-lightning-2'], rules: [{ condition: 'always', action: 'use_specific_jutsu', jutsuId: 'missing-technique' }] }]) {
        const actual = buildHollowGateSoloPveEncounter({ ...p, namedBossProfile });
        assert.deepEqual(actual.enemy, original.enemy); assert.equal(actual.encounter.metadata?.namedBossProfileId, undefined);
    }
});

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

test('named profile supplies a missing event name while respecting a sealed display override', () => {
    const p = params(100, 'boss'), named = builtinAiProfile('rift-boss-mirror-shard')!;
    p.run.bossProfileId = named.id;
    assert.equal(buildHollowGateSoloPveEncounter({ ...p, namedBossProfile: named }).enemy.name, named.name);
    p.run.bossName = 'The Sealed Mirror';
    assert.equal(buildHollowGateSoloPveEncounter({ ...p, namedBossProfile: named }).enemy.name, 'The Sealed Mirror');
});
