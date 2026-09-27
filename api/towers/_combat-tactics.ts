import type { TowerActor, TowerSession } from './_tower-session.js';
import { hexDistance } from '../combat-core/grid.js';
import { filledDiskTiles } from '../combat-core/aoe.js';
import { towerSignatureForMechanic, towerSignaturePattern } from '../../shared/tower-progression.js';

/** New public Tower runs opt in; embedded encounters and old sessions keep their rules. */
export function initializeTowerTactics(session: TowerSession): void {
    const boss = session.actors.find(a => a.id === session.phaseState.bossId);
    const mechanic = String(boss?.character.mechanic ?? '');
    session.towerTactics = { version: 2, disruptedPylons: [], chargeBaits: 0, avoidedStrikes: 0, squadKnockouts: [],
        ...(boss ? { signature: towerSignatureForMechanic(mechanic) } : {}),
    };
}
function status(actor: TowerActor, name: string, percent: number, round: number, source: string, rounds = 2) {
    actor.statuses = actor.statuses.filter(s => s.source !== source);
    actor.statuses.push({ name, percent, rounds, activeRound: round, kind: 'negative', source });
}
function chargeLane(from: number, target: number, width: number, height: number, reach = 8): number[] {
    const cube = (tile: number) => { const x=tile%width, z=Math.floor(tile/width)-(x-(x&1))/2; return [x,-x-z,z]; };
    const a=cube(from), b=cube(target), length=Math.max(1,hexDistance(from,target,width));
    const tiles: number[]=[];
    for(let i=1;i<=Math.min(reach,length+2);i++) {
        const point=a.map((value,j)=>value+(b[j]!-value)*i/length);
        const c=point.map(Math.round), errors=c.map((value,j)=>Math.abs(value-point[j]!));
        const axis=errors.indexOf(Math.max(...errors)); c[axis]=-c[(axis+1)%3]!-c[(axis+2)%3]!;
        const x=c[0]!, y=c[2]!+(x-(x&1))/2;
        if(x<0||x>=width||y<0||y>=height) break;
        const tile=y*width+x; if(!tiles.includes(tile)) tiles.push(tile);
    }
    return tiles;
}
export function primeTowerSignature(session: TowerSession): boolean {
    const tactics=session.towerTactics;
    if (!tactics?.signature) return false;
    const phased = tactics.version >= 2;
    const pattern = towerSignaturePattern(tactics.signature, phased ? session.phaseState.triggeredPhases.length : 0);
    if (!pattern.kind) return false;
    if (session.round < 2) return true;
    if (phased ? session.round - (tactics.lastSignatureRound ?? (2 - pattern.interval)) < pattern.interval
        : (session.round - 2) % 3 !== 0) return true;
    const boss = session.actors.find(a => a.id === session.phaseState.bossId && a.hp > 0);
    if (!boss) return true;
    const living = session.actors.filter(a => a.side === 'squad' && a.hp > 0);
    const distance = (a: TowerActor) => hexDistance(boss.pos, a.pos, session.map.width);
    // Hunting charges select a distant fighter they can actually reach.
    const candidates = pattern.farthest ? living.filter(a => distance(a) <= pattern.reach) : living;
    const target = [...(candidates.length ? candidates : living)]
        .sort((a,b) => (pattern.farthest ? distance(b)-distance(a) : distance(a)-distance(b)) || a.id.localeCompare(b.id))[0];
    if (!target) return true;
    const targets = [target];
    if (pattern.targets > 1) {
        const second = living.filter(a => a.id !== target.id)
            .sort((a,b) => hexDistance(target.pos,b.pos,session.map.width)-hexDistance(target.pos,a.pos,session.map.width) || a.id.localeCompare(b.id))[0];
        if (second) targets.push(second);
    }
    const kind = pattern.kind;
    let tiles = kind === 'charge' ? chargeLane(boss.pos,target.pos,session.map.width,session.map.height,pattern.reach)
        : [...new Set(targets.flatMap(a => [...filledDiskTiles(a.pos,1,session.map.width,session.map.height)]))].sort((a,b)=>a-b);
    if (kind === 'charge') { const wall=tiles.findIndex(t=>session.map.blockedTiles.includes(t)); if(wall>=0) tiles=tiles.slice(0,wall+1); }
    tactics.telegraph = {kind,origin:boss.pos,targetId:target.id};
    if (phased) tactics.lastSignatureRound = session.round;
    session.bossStrike = {tiles,round:session.round,pct:kind==='charge'?10:14,kind,label:`${boss.name}: ${pattern.name}`,center:boss.pos};
    session.log.push(`${session.bossStrike.label} targets ${targets.map(a=>a.name).join(' and ')}. ${pattern.counter}`);
    return true;
}
/** Displacement cancels a committed charge immediately, including its visible warning. */
export function cancelInvalidTowerSignature(session: TowerSession): boolean {
    const tactics = session.towerTactics;
    const warning = tactics?.telegraph;
    if (!tactics || !warning) return false;
    const boss = session.actors.find(actor => actor.id === session.phaseState.bossId && actor.hp > 0);
    if (boss && (warning.kind !== 'charge' || boss.pos === warning.origin)) return false;
    delete tactics.telegraph;
    session.bossStrike = undefined;
    if (boss) session.log.push(`${boss.name}'s charge is interrupted by displacement.`);
    return true;
}
/** Called immediately before the sealed strike resolves at round end. */
export function resolveTowerSignature(session: TowerSession): void {
    const tactics=session.towerTactics, warning=tactics?.telegraph, strike=session.bossStrike;
    if(!tactics || !warning || !strike || strike.round!==session.round) return;
    if(cancelInvalidTowerSignature(session)) return;
    delete tactics.telegraph;
    const boss=session.actors.find(a=>a.id===session.phaseState.bossId && a.hp>0);
    if(!boss) { session.bossStrike=undefined; return; }
    const caught=session.actors.some(a=>a.side==='squad' && a.hp>0 && strike.tiles.includes(a.pos));
    if(!caught) { tactics.avoidedStrikes++; status(boss,'Increase Damage Taken',20,session.round+1,'Missed signature'); session.log.push(`${boss.name} misses and is exposed for two rounds.`); }
    if(warning.kind==='charge') {
        for(const tile of strike.tiles) {
            if(session.map.blockedTiles.includes(tile)) {
                session.map.blockedTiles=session.map.blockedTiles.filter(t=>t!==tile);
                tactics.chargeBaits++;
                boss.shield=0;
                status(boss,'Stun',0,session.round+1,'Pillar collision',1);
                status(boss,'Increase Damage Taken',25,session.round+1,'Broken stance');
                session.log.push(`${boss.name} shatters a pillar! Guard broken and staggered.`);
                break;
            }
            if(!session.actors.some(a=>a.id!==boss.id && a.hp>0 && a.pos===tile)) boss.pos=tile;
        }
    }
}
export function recordTowerKnockouts(session: TowerSession): void {
    if(!session.towerTactics) return;
    for(const actor of session.actors) if(actor.side==='squad' && actor.hp<=0 && !actor.character.companion && !session.towerTactics.squadKnockouts.includes(actor.id)) session.towerTactics.squadKnockouts.push(actor.id);
}
