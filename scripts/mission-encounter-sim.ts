/** Bounded, offline production-engine comparison. No database or player writes. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { missionEnemyTemplate, missionEnvironment } from '../api/_authoritative-pve.js';
import { COMBAT_MISSIONS, combatMissionByKey } from '../api/missions/_mission-catalog.js';
import { earnedForLevel, maxHpForLevel, maxChakraForLevel, maxStaminaForLevel, rankFromLevel } from '../api/_xp-engine.js';
import { jutsuLevelCapForLevel } from '../api/combat-core/formulas.js';
import { hexDistance, hexNeighbors } from '../api/combat-core/grid.js';
import { GRID_W, GRID_H } from '../api/combat-core/constants.js';
import { hasCombatStatus } from '../api/combat-core/statuses.js';
import { buildSoloPveAiEncounter, type SoloPveAiProfile } from '../api/solo-pve/_ai-encounter.js';
import { applySoloPveAction } from '../api/solo-pve/_engine.js';
import { runSoloPveAiUntilPlayer } from '../api/solo-pve/_engine.js';
import { executeSoloPveAction } from '../api/solo-pve/_action-service.js';
import type { SoloPveAction, SoloPveSession, SoloPveJutsu } from '../api/solo-pve/_session.js';

export const MISSION_KEYS = COMBAT_MISSIONS.slice(2).map(m => m.key);
export const DISCIPLINES = ['Taijutsu', 'Bukijutsu', 'Ninjutsu', 'Genjutsu'] as const;
export type Policy = 'damage' | 'guard' | 'answer' | 'close';
export const EVIDENCE = 'docs/mission-encounter-evidence';
const BASELINE = `${EVIDENCE}/baseline-profiles.json`;
const prefixes = { Taijutsu: 'tai', Bukijutsu: 'buki', Ninjutsu: 'nin', Genjutsu: 'gen' };

/** Earned stat budget, level pools, starter gear, no bloodline/pet/premium.
 * Two schools/elements of ordinary Academy techniques plus common utility. */
export function missionPlayerSave(level: number, discipline: typeof DISCIPLINES[number] = 'Ninjutsu', name = 'MissionTester') {
    const statKeys = ['strength', 'speed', 'intelligence', 'willpower', ...DISCIPLINES.flatMap(d => [`${d.toLowerCase()}Offense`, `${d.toLowerCase()}Defense`])];
    const budget = earnedForLevel(level);
    const stats = Object.fromEntries(statKeys.map(k => [k, 10 + Math.floor(budget / statKeys.length)]));
    stats[`${discipline.toLowerCase()}Offense`] += budget % statKeys.length;
    const p = prefixes[discipline];
    const ids = [`starter-${p}-lightning-2`, `starter-${p}-water-2`, 'starter-gen-earth-1', 'starter-universal-flicker'];
    return { _saveVersion: 1, savedBloodlines: [], creatorJutsus: [], creatorItems: [], character: {
        name, level, rankTitle: rankFromLevel(level), specialty: discipline, bloodline: 'None',
        village: 'Stormveil Village', elements: ['Lightning', 'Water', 'Earth'],
        stats, earnedStatPoints: budget, unspentStats: 0, xp: 0, ryo: 0,
        hp: maxHpForLevel(level), maxHp: maxHpForLevel(level),
        chakra: maxChakraForLevel(level), maxChakra: maxChakraForLevel(level),
        stamina: maxStaminaForLevel(level), maxStamina: maxStaminaForLevel(level),
        onboardingStep: 'done', examsPassed: ['genin', 'chunin', 'jonin'],
        inventory: ['rustfang-kunai', 'shinobi-vest'], equipment: { hand: 'rustfang-kunai', body: 'shinobi-vest' },
        itemStacks: [], pets: [], equippedJutsuIds: ids,
        jutsuMastery: ids.map(jutsuId => ({ jutsuId, level: Math.max(1, Math.floor(jutsuLevelCapForLevel(level) / 2)), xp: 0 })),
    } };
}

export function missionSession(key: string, level = combatMissionByKey(key)!.min, discipline: typeof DISCIPLINES[number] = 'Ninjutsu', profile?: SoloPveAiProfile) {
    const def = combatMissionByKey(key)!;
    const env = missionEnvironment(key);
    return buildSoloPveAiEncounter({ sessionId: `sim-${key}`, playerName: 'missiontester',
        save: missionPlayerSave(level, discipline), profile: profile ?? { ...missionEnemyTemplate(def), id: def.aiProfileId },
        now: 1_780_000_000_000, admin: null, difficultyMode: 'MISSION', continuousVitals: true,
        encounter: { kind: 'mission', id: key, sourceId: def.aiProfileId },
        environment: { biome: env.biome, weatherPositiveElement: env.weather?.positiveElement, weatherNegativeElement: env.weather?.negativeElement },
    });
}

const has = (s: SoloPveSession, side: 'player' | 'enemy', name: string) => hasCombatStatus(s[side].statuses, name, s.round);
export function policyActions(s: SoloPveSession, policy: Policy): SoloPveAction[] {
    const distance = hexDistance(s.player.pos, s.enemy.pos);
    const moves = hexNeighbors(s.player.pos).filter(t => t !== s.enemy.pos && !s.environment.blockedTiles.includes(t))
        .sort((a,b) => hexDistance(a,s.enemy.pos) - hexDistance(b,s.enemy.pos) || a-b);
    const jutsu = s.player.character.jutsu as SoloPveJutsu[];
    const attacks: SoloPveAction[] = jutsu.filter(j => Number(j.effectPower) > 1 && !(j.tags ?? []).some(t => t.name === 'Move'))
        .map(j => ({ type: 'jutsu', jutsuId: j.id }));
    const choices: SoloPveAction[] = [];
    if (policy === 'answer') {
        if (has(s,'player','Poison') || has(s,'player','Decrease Damage Given') || has(s,'player','Increase Damage Taken')) choices.push({type:'cleanse'});
        if (has(s,'enemy','Decrease Damage Taken') || has(s,'enemy','Increase Damage Given') || has(s,'enemy','Reflect')) choices.push({type:'clear'});
    }
    // Both tags affect the caster. The canonical resolver permits this setup
    // before approaching; do not impose a fictitious opponent-range gate.
    if (policy === 'guard' && !has(s,'player','Decrease Damage Taken')) choices.push({type:'jutsu',jutsuId:'starter-gen-earth-1'});
    if (policy === 'close' && distance > 1) {
        const tiles = Array.from({length:GRID_W*GRID_H},(_,t)=>t).filter(t => t !== s.enemy.pos && t !== s.player.pos && hexDistance(t,s.player.pos) <= 5 && hexDistance(t,s.enemy.pos) === 1);
        for (const tile of tiles) choices.push({type:'jutsu',jutsuId:'starter-universal-flicker',tile});
        if (moves[0] !== undefined) choices.push({type:'move',tile:moves[0]});
    }
    choices.push(...attacks, {type:'basicAttack'}, {type:'weapon',itemId:'rustfang-kunai'});
    if (distance > 1 && moves[0] !== undefined) choices.push({type:'move',tile:moves[0]});
    choices.push({type:'wait'});
    return choices;
}

export function simulate(initial: SoloPveSession, policy: Policy = 'damage') {
    let s = initial;
    const distribution: Record<string,number> = {};
    const enemyTurns: number[] = [];
    const statuses = new Set<string>();
    let playerActions = 0, proposalsRejected = 0, lastSeq = 0, idleTurns = 0;
    const began = performance.now();
    for (let guard = 0; guard < 200 && s.status === 'active'; guard++) {
        let result: ReturnType<typeof applySoloPveAction> | undefined;
        for (const action of policyActions(s, policy)) {
            const start = performance.now();
            result = applySoloPveAction(s, action);
            if (!result.applied) { proposalsRejected++; continue; }
            if (result.session.events.some(e => e.seq > lastSeq && e.actor === 'enemy')) enemyTurns.push(performance.now()-start);
            break;
        }
        if (!result?.applied) throw new Error('Policy had no legal end-turn');
        s = result.session;
        const events = s.events.filter(e=>e.seq>lastSeq);
        playerActions += events.filter(e=>e.actor==='player' && e.action!=='wait').length;
        const enemy = events.filter(e=>e.actor==='enemy');
        if (enemy.length && enemy.every(e=>e.action==='wait')) idleTurns++;
        for (const e of enemy) distribution[e.actionId ?? e.action] = (distribution[e.actionId ?? e.action] ?? 0)+1;
        for (const e of events) for (const side of ['player','enemy'] as const) for (const status of e.after[side].statuses) statuses.add(status.name);
        lastSeq = s.eventSeq;
    }
    if (s.status !== 'done') throw new Error('Simulation exceeded 200 actions');
    return { session:s, metrics: { outcome:s.outcome, rounds:s.round, playerActions,
        hp:s.player.hp, chakra:s.player.chakra, stamina:s.player.stamina, consumables:s.itemsUsed,
        enemyActions:distribution, statuses:[...statuses].sort(), idleTurns, proposalsRejected,
        elapsedMs:performance.now()-began, enemyTurnMs:enemyTurns,
        initialBytes:Buffer.byteLength(JSON.stringify(initial)), finalBytes:Buffer.byteLength(JSON.stringify(s)),
    } };
}

async function main() {
    mkdirSync(EVIDENCE,{recursive:true});
    if(process.argv.includes('--fixtures')) {
        writeFileSync(`${EVIDENCE}/player-fixtures.json`,JSON.stringify(Object.fromEntries([15,30,50,70].map(level=>[level,missionPlayerSave(level)])),null,2)+'\n');
        return;
    }
    const capture = process.argv.includes('--capture-baseline');
    if (capture) writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(MISSION_KEYS.map(key => [key,{...missionEnemyTemplate(combatMissionByKey(key)!),id:combatMissionByKey(key)!.aiProfileId}])),null,2)+'\n',{flag:'wx'});
    const baseline = JSON.parse(readFileSync(BASELINE,'utf8'));
    if (process.argv.includes('--benchmark')) {
        const rows=[];
        for(const key of MISSION_KEYS) for(const variant of ['before','after']) {
            const times:number[]=[];
            for(let i=0;i<65;i++) {
                const s=missionSession(key,undefined,'Ninjutsu',variant==='before'?baseline[key]:undefined);
                s.round=3;s.activeSide='enemy';
                s.player.pos=Array.from({length:GRID_W*GRID_H},(_,t)=>t).find(t=>hexDistance(t,s.enemy.pos)===(i%2?1:4))!;
                const start=performance.now();runSoloPveAiUntilPlayer(s);
                if(i>=5) times.push(performance.now()-start);
            }
            times.sort((a,b)=>a-b);
            const batches=[];
            for(let repeat=0;repeat<5;repeat++) {
                const sessions=Array.from({length:16},(_,i)=>({...missionSession(key,undefined,'Ninjutsu',variant==='before'?baseline[key]:undefined),sessionId:`batch-${i}`}));
                const store=new Map(sessions.map(s=>[s.sessionId,s]));
                const start=performance.now();
                const results=await Promise.all(sessions.map(s=>executeSoloPveAction({sessionId:s.sessionId,ownerSlug:s.ownerSlug,expectedVersion:s.version,moveToken:'benchmark-token',action:{type:'wait'}},{
                    read:async id=>structuredClone(store.get(id)??null),write:async next=>{store.set(next.sessionId,structuredClone(next));},
                    lock:async(_key,fn)=>fn(),now:()=>s.createdAt+1,
                })));
                if(results.some(r=>!r.body.applied)) throw new Error('Concurrent-session benchmark rejected an action');
                batches.push(performance.now()-start);
            }
            rows.push({key,variant,samples:times.length,p50Ms:times[30],p95Ms:times[57],maxMs:times.at(-1),concurrent16BatchMs:batches,
                initialBytes:Buffer.byteLength(JSON.stringify(missionSession(key,undefined,'Ninjutsu',variant==='before'?baseline[key]:undefined)))});
        }
        writeFileSync(`${EVIDENCE}/benchmark.json`,JSON.stringify({node:process.version,platform:process.platform,rows},null,2)+'\n');
        console.log(JSON.stringify(rows,null,2));return;
    }
    if (process.argv.includes('--report')) {
        const {rows}=JSON.parse(readFileSync(`${EVIDENCE}/comparison.json`,'utf8'));
        const median=(a:number[])=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
        for(const key of MISSION_KEYS) for(const variant of ['before','after']) for(const policy of ['damage','guard','answer','close']) {
            const set=rows.filter((r:any)=>r.key===key&&r.variant===variant&&r.policy===policy&&r.stage==='admission');
            console.log(key,variant,policy,JSON.stringify({wins:set.filter((r:any)=>r.outcome==='win').length,rounds:set.map((r:any)=>r.rounds),hp:set.map((r:any)=>r.hp),medianHp:median(set.map((r:any)=>r.hp))}));
        }
        writeFileSync(`${EVIDENCE}/baseline.json`,JSON.stringify({node:process.version,deterministic:true,rows:rows.filter((r:any)=>r.variant==='before')},null,2)+'\n');
        return;
    }
    const rows = [];
    for (const key of MISSION_KEYS) for (const stage of ['admission','later','overlevel'] as const) for (const discipline of DISCIPLINES) {
        const min = combatMissionByKey(key)!.min;
        const level = Math.min(100,min + (stage==='admission'?0:stage==='later'?8:25));
        for (const variant of capture ? ['before'] : ['before','after']) for (const policy of ['damage','guard','answer','close'] as const) {
            const {metrics} = simulate(missionSession(key,level,discipline,variant==='before'?baseline[key]:undefined),policy);
            rows.push({key,stage,level,discipline,variant,policy,...metrics});
        }
    }
    const output = `${EVIDENCE}/${capture?'baseline':'comparison'}.json`;
    writeFileSync(output,JSON.stringify({node:process.version,deterministic:true,rows},null,2)+'\n');
    for (const key of MISSION_KEYS) for (const variant of capture?['before']:['before','after']) {
        const set = rows.filter(r=>r.key===key&&r.variant===variant&&r.policy==='damage');
        console.log(key,variant,JSON.stringify({wins:set.filter(r=>r.outcome==='win').length,n:set.length,rounds:set.map(r=>r.rounds),hp:set.map(r=>r.hp)}));
    }
    console.log(output,rows.length,'deterministic fights; no RNG/companions in these fixtures');
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/mission-encounter-sim.ts')) void main();
