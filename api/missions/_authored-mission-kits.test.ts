import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { AUTHORED_MISSION_KITS } from './_authored-mission-kits.js';
import { missionEnemyTemplate } from '../_authoritative-pve.js';
import { combatMissionByKey } from './_mission-catalog.js';
import { builtinAiProfile } from '../_ai-profile-catalog.js';
import { JUTSU_CATALOG } from '../pvp/_jutsu-catalog.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { applySoloPveAction, runSoloPveAiUntilPlayer } from '../solo-pve/_engine.js';
import { validateServerAiRules } from '../combat-core/ai-authoring.js';
import { activeCombatStatuses } from '../combat-core/statuses.js';
import { hexDistance } from '../combat-core/grid.js';
import { pveEnemyHitCap, pveGuardedEnemyHit } from '../_pve-difficulty.js';
import { DISCIPLINES, EVIDENCE, MISSION_KEYS, missionPlayerSave, missionSession, simulate } from '../../scripts/mission-encounter-sim.js';
import type { SoloPveSession } from '../solo-pve/_session.js';

const baseline = JSON.parse(readFileSync(`${EVIDENCE}/baseline-profiles.json`, 'utf8'));
function board(key: string, distance = 4, round = 3) {
    const s = missionSession(key);
    s.player.pos = Array.from({length:120},(_,t)=>t).find(t=>hexDistance(t,s.enemy.pos)===distance)!;
    s.activeSide = 'enemy'; s.round = round;
    return s;
}
const enemyActions = (s: SoloPveSession) => s.events.filter(e=>e.actor==='enemy').map(e=>e.actionId??e.action);
const names = (s: SoloPveSession, side: 'player'|'enemy') => activeCombatStatuses(s[side].statuses,s.round).map(t=>t.name);

describe('authored ordinary mission scope and sealing', () => {
    it('changes only selected mission kits and finite resources, retaining all baseline stats', () => {
        assert.deepEqual(Object.keys(AUTHORED_MISSION_KITS), MISSION_KEYS);
        for (const key of MISSION_KEYS) {
            const def = combatMissionByKey(key)!;
            const t = missionEnemyTemplate(def);
            for (const field of ['name','specialty','level','hp','stats','visual','boss','armorRawDR'] as const) assert.deepEqual(t[field],baseline[key][field],`${key}.${field}`);
            assert.equal(t.jutsu, undefined);
            assert.equal(t.missionTactics,true);
            assert.ok(validateServerAiRules(t.rules,t.jutsuIds!).ok);
            const s = missionSession(key);
            assert.deepEqual((s.enemy.character.jutsu as Array<{id:string}>).map(j=>j.id),t.jutsuIds);
            assert.equal(s.enemy.character.missionTactics,true);
            assert.equal(s.difficultyGuard?.enemyLevel,t.level);
            const shared = builtinAiProfile(def.aiProfileId)!;
            assert.notDeepEqual(shared.jutsuIds,t.jutsuIds);
            assert.ok(shared.jutsuIds!.length>=6);
        }
        for (const key of ['combat-e-drill','combat-d-errand']) assert.equal(missionEnemyTemplate(combatMissionByKey(key)!).missionTactics,undefined);
    });
    it('reports any missing required move; built-in content precedence remains intact', () => {
        for (const key of MISSION_KEYS) for (const id of AUTHORED_MISSION_KITS[key].jutsuIds) {
            const original = JUTSU_CATALOG[id];
            assert.ok(original,id);
            try {
                delete JUTSU_CATALOG[id];
                assert.throws(()=>missionSession(key),/not in this AI loadout/);
            } finally { JUTSU_CATALOG[id]=original; }
        }
        const def = combatMissionByKey(MISSION_KEYS[0])!;
        const id = AUTHORED_MISSION_KITS[def.key].jutsuIds[0];
        const s = buildSoloPveAiEncounter({sessionId:'override',playerName:'tester',save:missionPlayerSave(15),
            profile:{...missionEnemyTemplate(def),id:def.aiProfileId}, now:1,
            admin:{jutsu:new Map([[id,{...JUTSU_CATALOG[id],name:'Unapproved collision',effectPower:9999}]]),items:new Map()},
            encounter:{kind:'mission',id:def.key}});
        assert.equal((s.enemy.character.jutsu as Array<{name:string}>)[0].name,JUTSU_CATALOG[id].name);
    });
    it('clones programs and preserves sealed old and new encounters across JSON persistence', () => {
        const key = MISSION_KEYS[0], def = combatMissionByKey(key)!;
        const t = missionEnemyTemplate(def);
        t.jutsuIds!.pop(); t.rules![0].value=99;
        assert.equal(missionEnemyTemplate(def).rules![0].value,1);
        for (const profile of [baseline[key],undefined]) {
            const s = missionSession(key,15,'Ninjutsu',profile);
            const recovered = JSON.parse(JSON.stringify(s));
            assert.deepEqual(applySoloPveAction(s,{type:'wait'}).session,applySoloPveAction(recovered,{type:'wait'}).session);
            assert.equal(s.enemy.character.missionTactics,profile?undefined:true);
        }
    });
});

describe('distinct actual rule execution', () => {
    it('Ember creates a real opening then pays for its heavy attack; movement reduces the combo budget', () => {
        const s = board('combat-c-patrol',1); runSoloPveAiUntilPlayer(s);
        assert.deepEqual(enemyActions(s).slice(0,2),['starter-tai-earth-1','starter-tai-fire-2']);
        assert.ok(names(s,'player').includes('Increase Damage Taken'));
        assert.equal(s.events[0].before.ap.enemy-s.events[0].after.ap.enemy,40);
        assert.equal(s.events[1].before.ap.enemy-s.events[1].after.ap.enemy,60);
        assert.equal(s.events[1].before.enemy.chakra-s.events[1].after.enemy.chakra,250);
        const far = board('combat-c-patrol',6); runSoloPveAiUntilPlayer(far);
        assert.equal(enemyActions(far)[0],'starter-universal-flicker');
        assert.ok(!enemyActions(far).includes('starter-tai-fire-2'));
        const easy = board('combat-c-patrol',4,1); runSoloPveAiUntilPlayer(easy);
        assert.ok(!enemyActions(easy).includes('starter-tai-fire-2'),'easy-band burst delay preserved');
        assert.deepEqual(enemyActions(easy).slice(0,3),['starter-universal-flicker','starter-tai-earth-1','basicAttack']);
    });
    it('Frost protects itself and weakens attacks; Clear and Cleanse affect different fighters', () => {
        const s = board('combat-b-escort'); runSoloPveAiUntilPlayer(s);
        assert.deepEqual(enemyActions(s).slice(0,2),['starter-gen-fire-1','starter-gen-lightning-2']);
        assert.ok(names(s,'enemy').includes('Decrease Damage Taken'));
        assert.ok(names(s,'player').includes('Decrease Damage Given'));
        const cleared = applySoloPveAction(s,{type:'clear'});
        assert.ok(cleared.applied); assert.ok(!names(cleared.session,'enemy').includes('Decrease Damage Taken'));
        assert.ok(names(cleared.session,'player').includes('Decrease Damage Given'));
        const cleansed = applySoloPveAction(s,{type:'cleanse'});
        assert.ok(cleansed.applied); assert.ok(!names(cleansed.session,'player').includes('Decrease Damage Given'));
        assert.ok(names(cleansed.session,'enemy').includes('Decrease Damage Taken'));
        const gap = board('combat-b-escort'); gap.cooldowns.enemy['starter-gen-fire-1']=5;
        runSoloPveAiUntilPlayer(gap); assert.ok(!names(gap,'enemy').includes('Decrease Damage Taken'));
        assert.ok(!enemyActions(gap).includes('basicHeal'));
    });
    it('Shadow holds range after poisoning; closing suppresses its cast and Cleanse removes the tax', () => {
        const s = board('combat-a-hunt'); const pos=s.enemy.pos; runSoloPveAiUntilPlayer(s);
        assert.equal(enemyActions(s)[0],'starter-gen-water-2'); assert.equal(s.enemy.pos,pos);
        assert.ok(names(s,'player').includes('Poison'));
        const clean=applySoloPveAction(s,{type:'cleanse'});
        assert.ok(clean.applied); assert.ok(!names(clean.session,'player').includes('Poison'));
        const near = board('combat-a-hunt',1); runSoloPveAiUntilPlayer(near);
        assert.deepEqual(enemyActions(near).filter(a=>a!=='wait'),['basicAttack','basicAttack']);
        const follow = board('combat-a-hunt'); follow.player.statuses=[{name:'Poison',kind:'negative',rounds:2,percent:6}];
        runSoloPveAiUntilPlayer(follow); assert.equal(enemyActions(follow)[0],'starter-gen-earth-2');
    });
    it('Champion uses a shield/setup at range and a limited Reflect attack when approached', () => {
        const far=board('combat-s-crisis'); runSoloPveAiUntilPlayer(far);
        assert.deepEqual(enemyActions(far).slice(0,2),['starter-nin-earth-1','starter-buki-water-2']);
        assert.ok(far.enemy.shield>0);
        const clear=applySoloPveAction(far,{type:'clear'});
        assert.ok(clear.applied); assert.equal(clear.session.enemy.shield,0,'Clear removes flat shields');
        const near=board('combat-s-crisis',1); runSoloPveAiUntilPlayer(near);
        assert.equal(enemyActions(near)[0],'starter-tai-lightning-2'); assert.ok(names(near,'enemy').includes('Reflect'));
        const unavailable=board('combat-s-crisis',1); unavailable.cooldowns.enemy['starter-tai-lightning-2']=5;
        runSoloPveAiUntilPlayer(unavailable); assert.ok(!names(unavailable,'enemy').includes('Reflect'));
    });
});

describe('mission legality, budgets, and progression', () => {
    it('ends safely at edges, with occupied movement, sealed elements, Lag, and exhausted resources', () => {
        for (const key of MISSION_KEYS) for (const mode of ['edge','blocked','sealed','lag','empty','cooldowns']) {
            const s=board(key,4);
            if(mode==='edge') {s.enemy.pos=0;s.player.pos=119;}
            if(mode==='blocked') s.environment.blockedTiles=Array.from({length:120},(_,i)=>i).filter(i=>i!==s.enemy.pos&&i!==s.player.pos);
            if(mode==='sealed') s.enemy.statuses=[{name:'Elemental Seal',kind:'negative',rounds:2}];
            if(mode==='lag') s.enemy.statuses=[{name:'Lag',kind:'negative',rounds:2}];
            if(mode==='empty') {s.enemy.chakra=0;s.enemy.stamina=0;}
            if(mode==='cooldowns') for(const id of AUTHORED_MISSION_KITS[key].jutsuIds) s.cooldowns.enemy[id]=5;
            runSoloPveAiUntilPlayer(s);
            assert.ok(s.activeSide==='player'||s.status==='done',`${key} ${mode}`);
            assert.ok(s.events.filter(e=>e.actor==='enemy').length<=6);
            for(const e of s.events.filter(e=>e.actor==='enemy')) {
                assert.ok(e.after.ap.enemy>=0); assert.ok(e.after.enemy.chakra>=0); assert.ok(e.after.enemy.stamina>=0);
                if(e.action==='move') assert.ok(hexDistance(e.after.enemy.pos,e.after.player.pos)<hexDistance(e.before.enemy.pos,e.before.player.pos));
                if(mode==='sealed') assert.ok(e.action!=='jutsu'||e.actionId==='starter-universal-flicker');
            }
        }
    });
    it('retains per-hit and per-turn guards; no enemy kit obtains unlimited healing or permanent control', () => {
        for(const key of MISSION_KEYS) {
            let s=board(key,1); s.enemy.hp=Math.floor(s.enemy.maxHp/3);
            for(let i=0;i<12&&s.status==='active';i++) {
                if(s.activeSide==='enemy') runSoloPveAiUntilPlayer(s);
                else s=applySoloPveAction(s,{type:'wait'}).session;
            }
            for(const e of s.events.filter(e=>e.actor==='enemy')) {
                assert.notEqual(e.action,'basicHeal');
                if(e.action==='jutsu'||e.action==='basicAttack') assert.ok(e.before.player.hp-e.after.player.hp<=pveEnemyHitCap(Number(s.enemy.character.level),s.player.maxHp));
            }
            const protection=activeCombatStatuses(s.enemy.statuses,s.round).filter(t=>t.name==='Decrease Damage Taken');
            assert.ok(protection.length<=1);
            assert.ok(!s.player.statuses.some(t=>t.name==='Stun'||t.name==='Cleanse Prevent'));
        }
        assert.equal(pveGuardedEnemyHit(99999,{enemyLevel:18,playerMaxHp:1900,playerHpTurnStart:1000,dealtThisTurn:550}),20);
        assert.equal(pveGuardedEnemyHit(99999,{enemyLevel:18,playerMaxHp:1900,playerHpTurnStart:1000,dealtThisTurn:570}),0);
    });
    it('admits ordinary earned-stat builds across four disciplines and rewards later progression', () => {
        for(const key of MISSION_KEYS) for(const d of DISCIPLINES) {
            const min=combatMissionByKey(key)!.min;
            const early=simulate(missionSession(key,min,d)).metrics;
            const later=simulate(missionSession(key,Math.min(100,min+25),d)).metrics;
            assert.equal(early.outcome,'win',`${key} ${d}`);
            assert.equal(later.outcome,'win'); assert.ok(later.rounds<=early.rounds);
            assert.deepEqual(early.consumables,{}); assert.equal(early.idleTurns,0);
            assert.ok(early.rounds<=12,`${key} ${d}: ${early.rounds}`);
        }
    });
    it('shows measured benefits from responses with identical loadouts and starting conditions', () => {
        const comparisons = [
            ['combat-c-patrol','Bukijutsu','guard'],
            ['combat-b-escort','Ninjutsu','guard'],
            ['combat-a-hunt','Ninjutsu','close'],
            ['combat-a-hunt','Ninjutsu','answer'],
            ['combat-s-crisis','Ninjutsu','guard'],
            ['combat-s-crisis','Ninjutsu','answer'],
        ] as const;
        for(const [key,discipline,policy] of comparisons) {
            const initial=missionSession(key,undefined,discipline);
            const damage=simulate(initial,'damage').metrics;
            const response=simulate(initial,policy).metrics;
            assert.equal(response.outcome,'win');
            // A response either ends with more HP, or it spends a round that pure
            // damage did not need and still takes less damage per round. The S-rank
            // Champion is the second case with the 28 EP starter blade: pure damage
            // kills in 9 rounds, while clearing its shield and Reflect takes 10.
            const lossPerRound=(m: typeof damage)=>(initial.player.maxHp-m.hp)/m.rounds;
            assert.ok(
                response.hp>damage.hp||(damage.rounds<response.rounds&&lossPerRound(response)<lossPerRound(damage)),
                `${key} ${policy}: ${response.hp} hp in ${response.rounds} rounds vs ${damage.hp} hp in ${damage.rounds}`,
            );
        }
    });
});
