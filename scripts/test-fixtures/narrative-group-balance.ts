/** Progression-conserved, ordinary loadouts and a visible-state player policy. */
import { saveFor } from './hunt-accessibility.js';
import { STAT_KEYS, earnedForLevel, allocatedStatPoints } from '../../api/_xp-engine.js';
import { statCapForLevel } from '../../api/combat-core/formulas.js';
import { hexDistance } from '../../api/combat-core/grid.js';
import { isCombatStatusActive } from '../../api/combat-core/statuses.js';
import { applySoloPveAction } from '../../api/solo-pve/_engine.js';
import { applyAction as applyTowerAction, CLEANSE_CD } from '../../api/towers/_engine.js';
import type { SoloPveSession, SoloPveJutsu, SoloPveAction } from '../../api/solo-pve/_session.js';
import type { HuntCombatAction } from '../../shared/hunt-combat.js';

export const GROUP_SCHOOLS = ['Ninjutsu', 'Taijutsu', 'Bukijutsu', 'Genjutsu'] as const;
export type GroupSchool = typeof GROUP_SCHOOLS[number];
export function groupBalanceSave(level: number, school: GroupSchool, focused: boolean, masteryCap = 10) {
    const save = saveFor(level, 'balanced-nin', level < 5 ? 'robe' : 'reinforced', true);
    // Below level five use a real starter robe, not the level-five shop set.
    if (level < 5) { save.character.equipment = { body: 'cloth-robe' } as typeof save.character.equipment; save.character.inventory = ['cloth-robe']; }
    const generals = { Ninjutsu: ['speed', 'willpower'], Taijutsu: ['strength', 'speed'], Bukijutsu: ['intelligence', 'strength'], Genjutsu: ['intelligence', 'willpower'] }[school];
    const weights = Object.fromEntries(STAT_KEYS.map(key => [key, focused ? key === `${school.toLowerCase()}Offense` ? 3 : generals.includes(key) ? 1.7 : 1 : 1]));
    const weight = Object.values(weights).reduce((a, b) => a + b, 0), budget = earnedForLevel(level), cap = statCapForLevel(level);
    const stats = Object.fromEntries(STAT_KEYS.map(key => [key, Math.min(cap, 10 + Math.floor(budget * weights[key] / weight))]));
    let left = budget - allocatedStatPoints(stats as never);
    for (let i = 0; left > 0; i++) { const key = STAT_KEYS[i % STAT_KEYS.length]; if (stats[key] < cap) { stats[key]++; left--; } }
    const prefix = { Ninjutsu: 'nin', Taijutsu: 'tai', Bukijutsu: 'buki', Genjutsu: 'gen' }[school];
    const ids = ['lightning', 'water', 'fire', 'earth'].map(element => `starter-${prefix}-${element}-2`).concat(`starter-${prefix}-earth-1`, 'starter-universal-flicker');
    Object.assign(save.character, { specialty: school, stats, bloodline: 'None', pets: [], equippedJutsuIds: ids,
        jutsuMastery: save.character.jutsuMastery.slice(0, 1).flatMap(m => ids.map(jutsuId => ({ jutsuId, level: Math.min(m.level, masteryCap) }))) });
    if (allocatedStatPoints(stats as never) !== budget) throw new Error('Illegal progression budget');
    return save;
}

export function pilotGroup(initial: SoloPveSession, tactical = true, retainLog = false, healBelow = .45, useUtilities = false, answerSetups = false, windFirst = false) {
    if (!initial.huntCombat) return pilotStorySolo(initial, tactical, retainLog, healBelow, useUtilities, answerSetups, windFirst);
    let session = structuredClone(initial), actions = 0, rejected = 0, minHp = session.player.hp;
    const commands: Record<string, number> = {};
    const hpByRound: Array<{ round: number; hp: number; alive: number }> = [];
    while (session.status === 'active' && actions < 300) {
        const battle = session.huntCombat!.battle, player = battle.actors.find(a => a.id === 'player')!;
        const foes = battle.actors.filter(a => a.side === 'enemy' && a.hp > 0).sort((a, b) =>
            a.hp + a.shield - b.hp - b.shield || hexDistance(player.pos, a.pos, battle.map.width) - hexDistance(player.pos, b.pos, battle.map.width) || a.id.localeCompare(b.id));
        const foe = foes[0];
        if (!foe) throw new Error('Active encounter has no living enemy');
        const dist = (tile: number) => hexDistance(player.pos, tile, battle.map.width);
        const kit = player.character.jutsu as SoloPveJutsu[];
        const ready = kit.filter(j => (player.cooldowns[j.id] ?? 0) <= 0 && Number(j.ap) <= battle.activeAp && Number(j.chakraCost ?? 0) <= player.chakra && Number(j.staminaCost ?? 0) <= player.stamina);
        const damaging = ready.filter(j => Number(j.ap) >= 60 && Number(j.effectPower) > 0 && j.target !== 'SELF' && !j.tags?.some(t => t.name === 'Move'));
        const attacks: HuntCombatAction[] = [];
        for (const target of foes) {
            if (dist(target.pos) <= 1 && battle.activeAp >= 40) attacks.push({ type: 'attack', targetId: target.id });
            for (const j of damaging) if (dist(target.pos) <= Number(j.range ?? 1)) attacks.push({ type: 'jutsu', jutsuId: j.id, targetId: target.id });
        }
        const active = (name: string, target = player) => target.statuses.some(s => s.name === name && isCombatStatusActive(s, battle.round));
        const smoked = [player,...foes].some(target => target.statuses.some(s => s.source === 'item-smoke-bomb' && isCombatStatusActive(s,battle.round)));
        const worthClearing = (name: string) => foe.statuses.some(s => s.name === name && isCombatStatusActive(s,battle.round)
            && !['item-attack-pill','item-defense-pill'].includes(String(s.source)));
        let chosen: ReturnType<typeof applySoloPveAction> | undefined;
        let command: HuntCombatAction | undefined;
        const attempt = (action: HuntCombatAction) => {
            const result = applySoloPveAction(session, { type: 'huntAction', action });
            if (result.applied) { chosen = result; command = action; return true; } rejected++; return false;
        };
        // Visible HP and effects only. No simulation of future enemy turns to
        // pick a favorable action or seed-dependent outcome.
        const wounded = foes.find(target => target.hp < target.maxHp * .35 && !active('Reflect', target));
        if (!smoked && wounded) {
            const possible = attacks.filter(a => 'targetId' in a && a.targetId === wounded.id);
            const finishers = [possible.find(a=>a.type==='attack'),possible.find(a=>a.type==='jutsu')].filter(a=>a!==undefined);
            for (const action of finishers) {
                const preview=structuredClone({...battle,log:[],vfx:[]});
                const result=applyTowerAction(preview,preview.encounterFloor!,{actorId:player.id,...action},()=>.5);
                if (result.applied && !preview.actors.some(a=>a.id===wounded.id&&a.hp>0) && attempt(action)) break;
            }
        }
        if (!chosen && tactical) {
            if (player.hp < player.maxHp * (smoked ? 1 : healBelow)) attempt({ type: 'heal' });
            if (!chosen && !active('Cleanse Prevent') && player.statuses.some(s => s.kind === 'negative' && isCombatStatusActive(s, battle.round)
                && !(s.source === 'item-smoke-bomb' && foes.some(target=>target.statuses.some(t=>t.source==='item-smoke-bomb'&&isCombatStatusActive(t,battle.round))))
                && ['Poison', 'Ignition', 'Wound', 'Elemental Seal', 'Bloodline Seal', 'Decrease Damage Given', 'Increase Damage Taken'].includes(s.name))) attempt({ type: 'cleanse' });
            if (!chosen && (foe.shield > foe.maxHp * .1 || worthClearing('Reflect') || worthClearing('Decrease Damage Taken')
                || worthClearing('Increase Damage Given') || worthClearing('Lifesteal'))) attempt({ type: 'clear', targetId: foe.id });
        }
        if (!chosen && tactical) {
            const guard = ready.find(j => j.target === 'SELF' && j.tags?.some(t => ['Shield', 'Decrease Damage Taken', 'Reflect', 'Absorb'].includes(t.name) && !active(t.name)));
            if (guard) attempt({ type: 'jutsu', jutsuId: guard.id, targetId: player.id });
            // Catalog support tags can help the caster even when the technique
            // targets an opponent. Use the forty left after Cleanse instead
            // of waiting simply because no damaging signature fits that AP.
            const utility = ready.find(j => Number(j.effectPower) === 0 && Number(j.ap) === 40
                && !j.tags?.some(t=>t.name==='Move')
                && j.tags?.some(t=>['Increase Damage Given','Decrease Damage Taken','Reflect','Absorb','Shield'].includes(t.name) && !active(t.name)));
            const target = utility && foes.find(f=>dist(f.pos)<=Number(utility.range??1));
            if (!chosen && utility && target && battle.activeAp <= 40 && (player.cooldowns.cleanse??0)>=CLEANSE_CD) {
                attempt({type:'jutsu',jutsuId:utility.id,targetId:target.id});
            }
        }
        if (!chosen && !smoked) for (const attack of [...attacks].sort((a, b) => Number(b.type === 'jutsu') - Number(a.type === 'jutsu'))) { if (attempt(attack)) break; }
        if (!chosen) {
            const range = Math.max(1, ...ready.filter(j => Number(j.ap) >= 60).map(j => Number(j.range ?? 1)));
            const tiles = Array.from({ length: battle.map.width * battle.map.height }, (_, i) => i)
                .filter(tile => !battle.map.blockedTiles.includes(tile) && !battle.actors.some(a => a.hp > 0 && a.pos === tile))
                .sort((a, b) => Math.abs(hexDistance(a, foe.pos, battle.map.width) - range) - Math.abs(hexDistance(b, foe.pos, battle.map.width) - range) || dist(a) - dist(b) || a - b);
            if (dist(foe.pos) > range && ready.some(j => j.id === 'starter-universal-flicker')) {
                for (const tile of tiles.filter(tile => dist(tile) <= 5 && hexDistance(tile, foe.pos, battle.map.width) <= range)) if (attempt({ type: 'jutsu', jutsuId: 'starter-universal-flicker', tile })) break;
            }
            if (!chosen && dist(foe.pos) > range && battle.activeAp >= 30) {
                for (const tile of tiles.filter(tile => dist(tile) <= 3 && hexDistance(tile, foe.pos, battle.map.width) < dist(foe.pos))) if (attempt({ type: 'dash', tile })) break;
            }
        }
        if (!chosen) attempt({ type: 'wait' });
        if (!chosen?.applied || !command) throw new Error('No legal action');
        commands[command.type] = (commands[command.type] ?? 0) + 1;
        session = chosen.session; actions++; minHp = Math.min(minHp, session.player.hp);
        if (hpByRound.at(-1)?.round !== session.round) hpByRound.push({ round: session.round, hp: session.player.hp, alive: session.huntCombat!.battle.actors.filter(a => a.side === 'enemy' && a.hp > 0).length });
    }
    const enemies = session.huntCombat!.battle.actors.filter(a => a.side === 'enemy');
    return { outcome: session.outcome ?? 'unfinished', rounds: session.round, hp: session.player.hp, maxHp: session.player.maxHp, minHp,
        chakra: session.player.chakra, stamina: session.player.stamina, actions, rejected, commands, hpByRound,
        enemiesDefeated: enemies.filter(a => a.hp <= 0).length, enemies: enemies.length,
        ...(retainLog ? { log: session.log } : {}) };
}

/** Same visible-state priorities, through Solo's own actions and movement rules.
 * Do not turn a single story opponent into a Tower actor just for the audit. */
function pilotStorySolo(initial: SoloPveSession, tactical: boolean, retainLog: boolean, healBelow: number, useUtilities: boolean, answerSetups: boolean, windFirst: boolean) {
    let session = structuredClone(initial), actions = 0, rejected = 0, minHp = session.player.hp;
    const commands: Record<string, number> = {};
    const hpByRound: Array<{ round: number; hp: number; alive: number }> = [];
    while (session.status === 'active' && actions < 300) {
        const player = session.player, foe = session.enemy, ap = session.ap.player;
        const dist = (tile: number) => hexDistance(player.pos, tile, 12);
        const active = (name: string, target = player) => target.statuses.some(s => s.name === name && isCombatStatusActive(s, session.round));
        const smoked = [player,foe].some(target => target.statuses.some(s => s.source === 'item-smoke-bomb' && isCombatStatusActive(s,session.round)));
        const worthClearing = (name: string) => foe.statuses.some(s => s.name === name && isCombatStatusActive(s,session.round)
            && !['item-attack-pill','item-defense-pill'].includes(String(s.source)));
        const ready = (player.character.jutsu as SoloPveJutsu[]).filter(j => (session.cooldowns.player[j.id] ?? 0) <= 0
            && Number(j.ap) <= ap && Number(j.chakraCost ?? 0) <= player.chakra && Number(j.staminaCost ?? 0) <= player.stamina);
        if (windFirst) ready.sort((a,b) => Number(b.element === 'Wind') - Number(a.element === 'Wind'));
        let chosen: ReturnType<typeof applySoloPveAction> | undefined, command: SoloPveAction | undefined;
        const attempt = (action: SoloPveAction) => {
            const result = applySoloPveAction(session, action);
            if (result.applied) { chosen = result; command = action; return true; }
            rejected++; return false;
        };
        const wounded = foe.hp < foe.maxHp * .35 && dist(foe.pos) <= 1 && !active('Reflect', foe) && player.hp > player.maxHp * .2;
        if (!smoked && !answerSetups && wounded) {
            const result=applySoloPveAction(session,{type:'basicAttack'});
            const hit=result.session.events.find(e=>e.seq>session.eventSeq&&e.actor==='player');
            if(result.applied&&hit?.after.enemy.hp===0){chosen=result;command={type:'basicAttack'};}
        }
        if (!chosen && tactical) {
            if (!active('Cleanse Prevent') && player.statuses.some(s => s.kind === 'negative' && isCombatStatusActive(s, session.round)
                && !(s.source === 'item-smoke-bomb' && foe.statuses.some(t=>t.source==='item-smoke-bomb'&&isCombatStatusActive(t,session.round)))
                && ['Poison', 'Ignition', 'Wound', 'Elemental Seal', 'Bloodline Seal', 'Decrease Damage Given', 'Increase Damage Taken'].includes(s.name))) attempt({ type: 'cleanse' });
            const setup = answerSetups && foe.statuses.some(s => s.kind === 'positive' && isCombatStatusActive(s, session.round)
                && !['item-attack-pill','item-defense-pill'].includes(String(s.source))
                && ['Increase Damage Given', 'Increase Generals', 'Increase Heal', 'Absorb', 'Lifesteal'].includes(s.name));
            if (!chosen && (setup || foe.shield > foe.maxHp * .1 || worthClearing('Reflect') || worthClearing('Decrease Damage Taken'))) attempt({ type: 'clear' });
            if (!chosen && player.hp < player.maxHp * (smoked ? 1 : healBelow)) attempt({ type: 'basicHeal' });
            const guard = ready.find(j => j.target === 'SELF' && j.tags?.some(t => ['Shield', 'Decrease Damage Taken', 'Reflect', 'Absorb'].includes(t.name) && !active(t.name)));
            if (!chosen && guard) attempt({ type: 'jutsu', jutsuId: guard.id });
        }
        if (!chosen && !smoked && answerSetups) {
            const hand = (player.character.equipment as Record<string, string> | undefined)?.hand;
            if (hand) attempt({ type: 'weapon', itemId: hand });
        }
        // Large Solo bosses can still have thousands of HP below 35%. Keep
        // using ready signatures; the group pilot's chip-finisher is unsuitable.
        if (!chosen && tactical && useUtilities) {
            const utility = ready.find(j => j.target === 'OPPONENT' && Number(j.effectPower) === 0 && j.tags?.length && dist(foe.pos) <= Number(j.range ?? 1));
            const hits = ready.filter(j=>Number(j.effectPower)>0&&Number(j.ap)>=60&&j.target!=='SELF'
                && !j.tags?.some(t=>t.name==='Move')&&dist(foe.pos)<=Number(j.range??1));
            const justFlickered = session.actionsThisTurn > 0 && (session.cooldowns.player['starter-universal-flicker']??0)
                >= Number((player.character.jutsu as SoloPveJutsu[]).find(j=>j.id==='starter-universal-flicker')?.cooldown??Infinity);
            if (utility && (!justFlickered || !hits.length || hits.some(j=>Number(j.ap)+Number(utility.ap)<=ap))) attempt({ type: 'jutsu', jutsuId: utility.id });
        }
        if (!chosen && !smoked) for (const j of ready.filter(j => Number(j.ap) >= 60 && Number(j.effectPower) > 0 && j.target !== 'SELF'
            && !j.tags?.some(t => t.name === 'Move') && dist(foe.pos) <= Number(j.range ?? 1))) {
            if (attempt({ type: 'jutsu', jutsuId: j.id })) break;
        }
        if (!chosen && !smoked && dist(foe.pos) <= 1 && ap >= 40) attempt({ type: 'basicAttack' });
        if (!chosen) {
            const range = Math.max(1, ...ready.filter(j => Number(j.ap) >= 60).map(j => Number(j.range ?? 1)));
            const tiles = Array.from({ length: 120 }, (_, i) => i).filter(tile => !session.environment.blockedTiles.includes(tile) && tile !== player.pos && tile !== foe.pos)
                .sort((a, b) => hexDistance(a, foe.pos, 12) - hexDistance(b, foe.pos, 12) || dist(a) - dist(b) || a - b);
            if (dist(foe.pos) > range && ready.some(j => j.id === 'starter-universal-flicker')) {
                for (const tile of tiles.filter(tile => dist(tile) <= 5 && hexDistance(tile, foe.pos, 12) <= range))
                    if (attempt({ type: 'jutsu', jutsuId: 'starter-universal-flicker', tile })) break;
            }
            if (!chosen && dist(foe.pos) > range && ap >= 30) for (const tile of tiles.filter(tile => dist(tile) === 1 && hexDistance(tile, foe.pos, 12) < dist(foe.pos)))
                if (attempt({ type: 'move', tile })) break;
        }
        if (!chosen) attempt({ type: 'wait' });
        if (!chosen?.applied || !command) throw new Error('No legal solo action');
        commands[command.type] = (commands[command.type] ?? 0) + 1;
        session = chosen.session; actions++; minHp = Math.min(minHp, session.player.hp);
        if (hpByRound.at(-1)?.round !== session.round) hpByRound.push({ round: session.round, hp: session.player.hp, alive: Number(session.enemy.hp > 0) });
    }
    return { outcome: session.outcome ?? 'unfinished', rounds: session.round, hp: session.player.hp, maxHp: session.player.maxHp, minHp,
        healingDone: session.legacyTotals?.healingDone ?? 0,
        chakra: session.player.chakra, stamina: session.player.stamina, actions, rejected, commands, hpByRound,
        enemiesDefeated: Number(session.enemy.hp <= 0), enemies: 1, ...(retainLog ? { log: session.log } : {}) };
}
