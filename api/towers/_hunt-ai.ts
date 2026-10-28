import { hexDistance } from '../combat-core/grid.js';
import { enemyStatusValue, enemyTurnValue, type EnemyTurnSnapshot } from '../solo-pve/_ai-turn-policy.js';
import { pveEasyBandHoldsBurst, pveEasyBandAllowsLethal, pveAiCompetence, pveDifficultyBand } from '../_pve-difficulty.js';
import { pveMeaningfulBuffCount } from '../_pve-ai-tactics.js';
import { activeCombatStatuses } from '../combat-core/statuses.js';
import { aiGapCloserLandingTile, aiApproachLandingTile, aiRangedAttackReach, isDamagingAiGapCloser, isDistantAiGapCloser, prefersAiGapClosingMovement, aiJustFlickered, isAiFlicker } from '../combat-core/ai-mobility.js';
import type { TowerAction } from './_engine.js';
import type { TowerActor, TowerSession } from './_tower-session.js';

export const HUNT_AI_POLICY = 'hunt-v1';
export const HUNT_REACTIVE_POLICY = 'wounded-v1';
type HuntJutsu = {id:string;ap?:number;range?:number;target?:string;effectPower?:number;
    chakraCost?:number;staminaCost?:number;aiHpBelowPct?:number;aiHpAbovePct?:number;tags?:Array<{name?:string}>};

function healthGate(actor: TowerActor, j: HuntJutsu): boolean {
    const hp = actor.hp * 100 / Math.max(1,actor.maxHp);
    return (j.aiHpBelowPct === undefined || hp <= j.aiHpBelowPct) && (j.aiHpAbovePct === undefined || hp >= j.aiHpAbovePct);
}

/** A sealed, visibly wounded lone C+ target may answer on round two. Old
 * sessions, beginner contracts and every multi-creature formation keep their
 * original clock. The resolver still owns AP, mastery and easy-band caps. */
export function huntHoldsBurst(session: TowerSession, actor: TowerActor): boolean {
    if (aiJustFlickered((actor.character.jutsu ?? []) as HuntJutsu[], actor.cooldowns, session.actionsThisTurn)) return false;
    if (actor.character.huntReactivePolicy === HUNT_REACTIVE_POLICY && session.round === 2
        && Number(actor.character.level) > 15 && ['C','B','A','S'].includes(String(actor.character.huntRank))
        && actor.hp <= actor.maxHp * .75
        && !session.pendingEnemyWaves?.some(w => w.actors.some(a => a.hp > 0))
        && session.actors.filter(a => a.side === 'enemy' && a.hp > 0).length === 1
        && session.actors.some(a => a.side === 'squad' && Number(a.character.level) > 15)) return false;
    return pveEasyBandHoldsBurst(Number(actor.character.level) || 1, session.round);
}
export function huntOpeningIsPreparation(session: TowerSession, actor: TowerActor): boolean {
    return session.round===1 && pveDifficultyBand(Number(actor.character.level) || 1)==='easy'
        && !aiJustFlickered((actor.character.jutsu ?? []) as HuntJutsu[], actor.cooldowns, session.actionsThisTurn);
}

type Hooks = {
    apply: (session: TowerSession, action: TowerAction) => { applied: boolean };
    step: (session: TowerSession, actor: TowerActor, target: TowerActor) => number;
    ready: (session: TowerSession, actor: TowerActor, jutsuId: string) => boolean;
};

/** A bounded, hunt-only chooser. Previews use the real Tower resolver, including
 * AP, cooldowns, seals, resources, mastery and guard. No player loadout is read. */
export function pickHuntAiAction(session: TowerSession, actor: TowerActor, hooks: Hooks): TowerAction {
    const target = session.actors.filter(a => a.side !== actor.side && a.side !== 'npc' && a.hp > 0)
        .sort((a,b) => hexDistance(actor.pos,a.pos,session.map.width)-hexDistance(actor.pos,b.pos,session.map.width) || a.id.localeCompare(b.id))[0];
    if (!target) return { actorId: actor.id, type: 'wait' };
    let decisionReach: number | undefined;
    const snapshot = (s: TowerSession): EnemyTurnSnapshot => {
        const self = s.actors.find(a => a.id === actor.id)!;
        const foe = s.actors.find(a => a.id === target.id)!;
        const reach = ((self.character.jutsu ?? []) as HuntJutsu[]).filter(j => healthGate(self,j)
            && Number(j.effectPower)>0 && j.target!=='SELF' && !j.tags?.some(t=>t.name==='Move')
            && !(huntHoldsBurst(s,self) && Number(j.ap ?? 40)>=60)
            && hooks.ready(s,self,j.id))
            .reduce((max,j)=>Math.max(max,Number(j.range) || 1),1);
        // Spending AP or starting a cooldown must not make a successful ranged
        // hit look like a positional retreat in the same decision.
        decisionReach ??= reach;
        const status = (a: TowerActor, kind: 'positive' | 'negative') => a.statuses.filter(t => t.kind === kind)
            .reduce((sum,t) => sum + enemyStatusValue(t, { round: s.round, hp: a.hp, maxHp: a.maxHp, shield: a.shield,
                positiveCount: a.statuses.filter(t => t.kind === 'positive').length,
                negativeCount: a.statuses.filter(t => t.kind === 'negative').length }), 0);
        return { playerHp: foe.hp, playerShield: foe.shield, playerMaxHp: foe.maxHp,
            enemyHp: self.hp, enemyShield: self.shield, enemyMaxHp: self.maxHp,
            playerPositive: status(foe,'positive'), playerNegative: status(foe,'negative'),
            enemyPositive: status(self,'positive'), enemyNegative: status(self,'negative'),
            distance: hexDistance(self.pos,foe.pos,s.map.width), enemyReach: decisionReach,
            enemyAp: s.activeAp, enemyChakra: self.chakra, enemyMaxChakra: self.maxChakra,
            enemyStamina: self.stamina, enemyMaxStamina: self.maxStamina };
    };
    const candidates = (s: TowerSession): TowerAction[] => {
        const self = s.actors.find(a => a.id === actor.id)!;
        const foe = s.actors.find(a => a.id === target.id)!;
        const preparation=huntOpeningIsPreparation(s,self);
        const actions: TowerAction[] = preparation?[]:[{ actorId: self.id, type: 'attack', targetId: foe.id }];
        const step = hooks.step(s,self,foe);
        if (step !== self.pos && !prefersAiGapClosingMovement((self.character.jutsu ?? []) as HuntJutsu[],
            hexDistance(self.pos,foe.pos,s.map.width))) actions.push({actorId:self.id,type:'move',tile:step});
        const comp = pveAiCompetence(Number(self.character.level) || 1);
        const buffs = pveMeaningfulBuffCount(activeCombatStatuses(foe.statuses,s.round));
        if (Number.isFinite(comp.clearBuffThreshold) && buffs + Number(foe.shield >= foe.maxHp * .1) >= comp.clearBuffThreshold)
            actions.push({ actorId:self.id,type:'clear',targetId:foe.id });
        if (self.statuses.filter(t=>t.kind==='negative' && t.rounds>0).length >= comp.cleanseSelfThreshold)
            actions.push({actorId:self.id,type:'cleanse'});
        for (const j of (self.character.jutsu ?? []) as HuntJutsu[]) {
            if (!healthGate(self,j)) continue;
            if (preparation && Number(j.effectPower)>0 && j.target!=='SELF' && !j.tags?.some(t=>t.name==='Move')) continue;
            if (huntHoldsBurst(s,self) && Number(j.ap ?? 40) >= 60
                && !isDistantAiGapCloser(j, hexDistance(self.pos, foe.pos, s.map.width))) continue;
            if (j.tags?.some(t=>t.name==='Move')) {
                const tile = isDamagingAiGapCloser(j) ? aiGapCloserLandingTile({
                    jutsu: j, from: self.pos, target: foe.pos, width: s.map.width, height: s.map.height,
                    blocked: i => s.map.blockedTiles.includes(i) || s.actors.some(a => a.hp > 0 && a.pos === i),
                }) : isAiFlicker(j) ? aiApproachLandingTile({
                    range: Number(j.range ?? 5), reach: aiRangedAttackReach(((self.character.jutsu ?? []) as HuntJutsu[])
                        .filter(next => hooks.ready(s,self,next.id) && Number(next.ap??40)+Number(j.ap??20) <= s.activeAp
                            && Number(next.chakraCost??0)+Number(j.chakraCost??0)<=self.chakra
                            && Number(next.staminaCost??0)+Number(j.staminaCost??0)<=self.stamina)),
                    from: self.pos, target: foe.pos, width: s.map.width, height: s.map.height,
                    blocked: i => s.map.blockedTiles.includes(i) || s.actors.some(a => a.hp > 0 && a.pos === i),
                }) : Array.from({length:s.map.width*s.map.height},(_,i)=>i)
                    .filter(i=>i!==self.pos && hexDistance(self.pos,i,s.map.width)<=Number(j.range ?? 5)
                        && !s.map.blockedTiles.includes(i) && !s.actors.some(a=>a.hp>0 && a.pos===i))
                    .sort((a,b)=>hexDistance(a,foe.pos,s.map.width)-hexDistance(b,foe.pos,s.map.width) || a-b)[0];
                if (tile!==undefined) actions.push({actorId:self.id,type:'jutsu',jutsuId:j.id,tile});
            } else actions.push({actorId:self.id,type:'jutsu',jutsuId:j.id,
                ...(j.target==='SELF' ? {} : j.target==='EMPTY_GROUND' ? {tile:foe.pos} : {targetId:foe.id})});
        }
        return actions;
    };
    const start = snapshot(session);
    const baseline = enemyTurnValue(start,start);
    const rank = String(actor.character.huntRank ?? 'D');
    const depth = Number(actor.character.level) <= 15 || rank==='D' ? 1 : ['A','S'].includes(rank) ? 3 : 2;
    // Strip presentation history before cloning; work is independent of battle age.
    const seed: TowerSession = {...session,log:[],vfx:[]};
    let frontier = [{state:seed, first:null as TowerAction | null, firstValue:baseline}];
    let best: {action:TowerAction;value:number;firstValue:number;key:string} | undefined;
    let simulations=0;
    for(let d=0;d<depth && simulations<96;d++) {
        const next: Array<{state:TowerSession;first:TowerAction;firstValue:number;value:number}> = [];
        for(const node of frontier) {
          const previews: Array<{action:TowerAction;after:TowerSession;value:number}> = [];
          for(const action of candidates(node.state)) {
            if(simulations++>=96) break;
            const after=structuredClone(node.state);
            if(!hooks.apply(after,action).applied) continue;
            const value=enemyTurnValue(start,snapshot(after));
            previews.push({action,after,value});
          }
          const foe = node.state.actors.find(a=>a.id===target.id)!;
          const spare = !pveEasyBandAllowsLethal(Number(actor.character.level) || 1,foe.hp/Math.max(1,foe.maxHp))
            && previews.some(p=>{const hp=p.after.actors.find(a=>a.id===foe.id)!.hp;return hp>0 && hp<foe.hp;});
          for(const {action,after,value} of previews) {
            if(spare && after.actors.find(a=>a.id===foe.id)!.hp<=0) continue;
            const first=node.first ?? action, firstValue=node.first ? node.firstValue : value;
            const key=JSON.stringify(first);
            if(!best || value>best.value || value===best.value && (firstValue>best.firstValue || firstValue===best.firstValue && key<best.key))
                best={action:first,value,firstValue,key};
            if(after.status==='active' && after.actionsThisTurn<5) next.push({state:after,first,firstValue,value});
          }
        }
        frontier=next.sort((a,b)=>b.value-a.value || JSON.stringify(a.first).localeCompare(JSON.stringify(b.first))).slice(0,3);
    }
    return best && best.value>baseline+.001 ? best.action : {actorId:actor.id,type:'wait'};
}
