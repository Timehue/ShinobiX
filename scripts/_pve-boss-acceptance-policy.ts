/** Offline, public-state competent boss policy. No production caller. */
import { applyAction, startRound, endTurn, pickAiAction, nextStepToward, towerNeighbors, type TowerAction } from '../api/towers/_engine.js';
import { activeActor, type TowerActor, type TowerSession } from '../api/towers/_tower-session.js';
import type { TowerFloor } from '../api/towers/_floor-catalog.js';
import { makeRng } from '../api/towers/_sim.js';
import { hexDistance } from '../api/combat-core/grid.js';
import { snapshotWorldBossContribution, recordWorldBossContribution, scoreWorldBossContribution } from '../api/world-boss-event/_contribution.js';
const positive = (actor: TowerActor, name: string, round: number) => actor.statuses.some(s => s.name === name && s.rounds > 0 && (s.activeRound ?? 0) <= round && (s.inactiveRound ?? Infinity) > round);
type TeamEngine = Pick<typeof import('../api/towers/_engine.js'), 'applyAction' | 'startRound' | 'endTurn' | 'pickAiAction' | 'nextStepToward' | 'towerNeighbors'>;
const currentTeamEngine: TeamEngine = { applyAction, startRound, endTurn, pickAiAction, nextStepToward, towerNeighbors };

/** Public-state bounded policy: dodge marked tiles, clear guards, maintain a
 * damage setup, use sustain when injured, focus adds, then legal best immediate
 * damage. Resolver previews decide legality and current outcomes only. */
function squadAction(session: TowerSession, floor: TowerFloor, actor: TowerActor, cautious: boolean, engine: TeamEngine, preferred: string[] = [], guardCounterplay = false): TowerAction {
    const enemies = session.actors.filter(a => a.side === 'enemy' && a.hp > 0).sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id));
    const target = enemies[0];
    if (!target) return { actorId: actor.id, type: 'wait' };
    const danger = new Set([...(session.map.hazardTiles ?? []), ...(session.map.nextRoundHazardTiles ?? []), ...(session.bossStrike?.tiles ?? [])]);
    const legal = (action: TowerAction) => engine.applyAction(structuredClone({ ...session, log: [], vfx: [] }), floor, action, () => .5).applied;
    const vacant = (tile: number) => !session.map.blockedTiles.includes(tile) && !session.actors.some(a => a.hp > 0 && a.id !== actor.id && a.pos === tile);
    if (cautious && danger.has(actor.pos)) {
        const queue = [{ tile: actor.pos, first: actor.pos, depth: 0 }], visited = new Set([actor.pos]);
        const budget = Math.floor(session.activeAp / 30);
        for (let i = 0; i < queue.length; i++) {
            const at = queue[i]; if (at.depth >= budget) continue;
            for (const tile of engine.towerNeighbors(at.tile, session.map.width, session.map.height).filter(vacant).sort((a, b) => hexDistance(a, target.pos, session.map.width) - hexDistance(b, target.pos, session.map.width))) {
                if (visited.has(tile)) continue; visited.add(tile);
                const first = at.depth === 0 ? tile : at.first;
                if (!danger.has(tile)) { const action: TowerAction = { actorId: actor.id, type: 'move', tile: first }; if (legal(action)) return action; }
                queue.push({ tile, first, depth: at.depth + 1 });
            }
        }
    }
    const pylon = cautious && session.towerTactics && session.map.features?.find(feature => feature.kind === 'pylon'
        && !session.towerTactics!.disruptedPylons.includes(feature.tiles[0]!)
        && hexDistance(actor.pos, feature.tiles[0]!, session.map.width) <= 1);
    if (pylon) { const action: TowerAction = { actorId: actor.id, type: 'disrupt', tile: pylon.tiles[0]! }; if (legal(action)) return action; }
    const priorities: TowerAction[] = [];
    for (const id of preferred) {
        const jutsu = (actor.character.jutsu as Array<{ id: string; tags?: Array<{ name: string }> }>).find(j => j.id === id);
        if (!jutsu) continue;
        const tags = jutsu.tags ?? [];
        if (tags.some(t => ['Reflect', 'Drain'].includes(t.name) && (positive(actor, t.name, session.round) || positive(target, t.name, session.round)))) continue;
        priorities.push({ actorId: actor.id, type: 'jutsu', jutsuId: id, targetId: target.id });
    }
    if (cautious && actor.statuses.some(s => s.kind === 'negative' && ['Poison', 'Wound', 'Drain', 'Recoil', 'Increase Damage Taken', 'Decrease Damage Given'].includes(s.name))) priorities.push({ actorId: actor.id, type: 'cleanse' });
    if (cautious && actor.hp < actor.maxHp * .35) priorities.push({ actorId: actor.id, type: 'heal' });
    const clearGuard = guardCounterplay && target.id === session.clanBossGuard?.bossId && session.round > session.clanBossGuard.openThroughRound && !positive(target, 'Clear Prevent', session.round);
    if (cautious && (clearGuard || target.shield > 400 || positive(target, 'Reflect', session.round) || positive(target, 'Decrease Damage Taken', session.round) || positive(target, 'Absorb', session.round) || positive(target, 'Lifesteal', session.round) || positive(target, 'Increase Damage Given', session.round))) priorities.push({ actorId: actor.id, type: 'clear', targetId: target.id });
    if (!positive(actor, 'Increase Damage Given', session.round)) priorities.push({ actorId: actor.id, type: 'jutsu', jutsuId: 'starter-gen-earth-1', targetId: target.id });
    if (cautious && actor.hp < actor.maxHp * .8 && !positive(actor, 'Lifesteal', session.round)) priorities.push({ actorId: actor.id, type: 'jutsu', jutsuId: 'starter-nin-earth-3', targetId: target.id });
    if (cautious && actor.shield < 200 && !positive(target, 'Increase Damage Taken', session.round)) priorities.push({ actorId: actor.id, type: 'jutsu', jutsuId: 'starter-nin-earth-1', targetId: target.id });
    for (const action of priorities) if (legal(action)) return action;
    const candidates: TowerAction[] = [
        ...(actor.character.jutsu as Array<{ id: string; effectPower?: number }>).filter(j => Number(j.effectPower) > 1 && !j.id.includes('flicker')).map(j => ({ actorId: actor.id, type: 'jutsu' as const, jutsuId: j.id, targetId: target.id })),
        { actorId: actor.id, type: 'weapon', targetId: target.id }, { actorId: actor.id, type: 'attack', targetId: target.id },
    ];
    let best: { score: number; action: TowerAction } | undefined;
    for (const action of candidates) {
        const preview = structuredClone({ ...session, log: [], vfx: [] });
        if (!engine.applyAction(preview, floor, action, () => .5).applied) continue;
        const score = enemies.reduce((total, enemy) => { const after = preview.actors.find(a => a.id === enemy.id)!; return total + enemy.hp - after.hp + Math.max(0, enemy.shield - after.shield); }, 0)
            + Math.max(0, preview.actors.find(a => a.id === actor.id)!.hp - actor.hp) * 1.2;
        if (!best || score > best.score) best = { score, action };
    }
    if (best && best.score > 0) return best.action;
    const move = engine.nextStepToward(session, actor.pos, target.pos, actor.id);
    if (move !== actor.pos && (!cautious || !danger.has(move))) { const action: TowerAction = { actorId: actor.id, type: 'move', tile: move }; if (legal(action)) return action; }
    return { actorId: actor.id, type: 'wait' };
}

export function runAuditedBossTeam(session: TowerSession, floor: TowerFloor, cautious = true, engine: TeamEngine = currentTeamEngine, preferredByOwner: Record<string, string[]> = {}, guardCounterplay = false) {
    const rng = makeRng(session.seed);
    const totals = Object.fromEntries(session.actors.filter(a => a.side === 'squad').map(a => [a.id, { maxHp: a.maxHp, initialHp: a.hp, minimumHp: a.hp, hpLossObservedLowerBound: 0, hpRecoveryObservedLowerBound: 0, shieldLossDuringEnemyActions: 0, shieldGainObserved: 0, shieldExpiredOrLostAtTurnBoundary: 0 }]));
    const track = (fn: () => unknown, enemyAction = false, boundary = false) => {
        const before = session.actors.filter(a => a.side === 'squad').map(a => ({ id: a.id, hp: a.hp, shield: a.shield }));
        fn();
        for (const old of before) { const a = session.actors.find(a => a.id === old.id)!; const t = totals[a.id];
            t.minimumHp = Math.min(t.minimumHp, a.hp);
            t.hpLossObservedLowerBound += Math.max(0, old.hp - a.hp); t.hpRecoveryObservedLowerBound += Math.max(0, a.hp - old.hp);
            t.shieldGainObserved += Math.max(0, a.shield - old.shield);
            if (enemyAction) t.shieldLossDuringEnemyActions += Math.max(0, old.shield - a.shield);
            if (boundary) t.shieldExpiredOrLostAtTurnBoundary += Math.max(0, old.shield - a.shield);
        }
    };
    track(() => engine.startRound(session));
    let actions = 0, guard = 0;
    while (session.status === 'active' && guard++ < 4000) {
        const actor = activeActor(session);
        if (!actor || actor.hp <= 0) { track(() => engine.endTurn(session, floor), false, true); continue; }
        const action = actor.side === 'squad' ? squadAction(session, floor, actor, cautious, engine, preferredByOwner[actor.ownerSlug ?? ''] ?? [], guardCounterplay) : engine.pickAiAction(session, actor, rng);
        if (action.type === 'wait') { track(() => engine.endTurn(session, floor), false, true); continue; }
        let applied = false;
        const beforeContribution = snapshotWorldBossContribution(session);
        track(() => { applied = engine.applyAction(session, floor, action, rng).applied; }, actor.side === 'enemy');
        if (applied && actor.side === 'squad') recordWorldBossContribution(session, actor.id, beforeContribution);
        if (applied) actions++; else track(() => engine.endTurn(session, floor), false, true);
    }
    if (session.status !== 'done') throw new Error(`Probe failed to terminalize ${session.runId}`);
    const boss = session.actors.find(a => a.id === session.phaseState.bossId)!;
    return { rounds: session.round, winner: session.winner, survivors: session.actors.filter(a => a.side === 'squad' && a.hp > 0).length, actions,
        bossRemainingHp: boss.hp, bossMaxHp: boss.maxHp, bossShield: boss.shield,
        players: session.actors.filter(a => a.side === 'squad').map(a => ({ id: a.id, ...totals[a.id], finalHp: a.hp, netHpLoss: totals[a.id].initialHp - a.hp, finalShield: a.shield, finalChakra: a.chakra, finalStamina: a.stamina })),
        ...(session.worldBossEvent ? { contribution: Object.fromEntries(Object.entries(session.worldBossContributions ?? {}).map(([slug, contribution]) => [slug, scoreWorldBossContribution(contribution)])), bankableTeamDamage: Object.values(session.worldBossContributions ?? {}).reduce((n, contribution) => n + contribution.damage, 0) } : {}),
        terminalLog: session.log.slice(-5) };
}

