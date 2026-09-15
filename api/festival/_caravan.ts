import { randomUUID } from 'node:crypto';
import { dailyLoginRyo } from '../player/_daily-login.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { petCombatBusyReason } from '../pet/_pet-busy.js';
import { grantFestivalTitles } from './_prestige.js';
import { caravanDaily } from '../../shared/sunscar/caravan-contracts.js';
import { generateCaravanMap } from '../../shared/sunscar/caravan-map.js';
import { caravanObjectiveComplete, currentCaravanNode, resolveCaravanChoice, selectCaravanNode } from '../../shared/sunscar/caravan-state.js';
import { clamp } from '../../shared/sunscar/random.js';
import type { CaravanEffect, CaravanProgress, CaravanRun, CaravanTool } from '../../shared/sunscar/caravan-types.js';
import { FestivalError, festivalDay } from './_rally.js';

type Obj = Record<string, unknown>;
export function caravanProgress(character: Obj): CaravanProgress {
    return character.sunscarCaravan ? structuredClone(character.sunscarCaravan as CaravanProgress) : { reputation: 0, deliveries: 0, lastEntryDay: null, current: null, chains: {}, discoveries: [], history: [] };
}
export function requireCaravan(character: Obj, id?: unknown): { progress: CaravanProgress; run: CaravanRun } {
    const progress = caravanProgress(character);
    if (!progress.current || id !== undefined && progress.current.id !== id) throw new FestivalError('This expedition changed. Reload the caravan board.', 409);
    return { progress, run: progress.current };
}
export function departCaravan(character: Obj, player: string, body: Obj, now: number): Obj {
    const progress = caravanProgress(character);
    if (progress.current && !['complete', 'failed'].includes(progress.current.status)) throw new FestivalError('Resume your active expedition before taking another contract.', 409);
    const day = festivalDay(now);
    if (progress.lastEntryDay === day) throw new FestivalError('Your daily contract is already recorded. New contracts arrive at the UTC reset.', 409);
    if (isIncapacitated(character) || Number(character.hp) <= 0) throw new FestivalError('Recover at the hospital before accepting an escort.', 409);
    if (character.hollowGateRun) throw new FestivalError('Finish your Hollow Gate run before leaving with the caravan.', 409);
    const daily = caravanDaily(player, day, progress);
    const contract = daily.contracts.find(c => c.id === body.contractId);
    if (!contract) throw new FestivalError('Choose one of today’s contracts.');
    if (progress.reputation < contract.reputationRequired) throw new FestivalError(`This employer requires ${contract.reputationRequired} Caravan reputation.`, 409);
    if (!Array.isArray(body.tools) || body.tools.length !== 3 || body.tools.some(t => !['water', 'repair', 'smoke', 'map', 'medicine', 'feed'].includes(String(t)))) throw new FestivalError('Choose exactly three expedition supplies.');
    const tools: Record<CaravanTool, number> = { water: 0, repair: 0, smoke: 0, map: 0, medicine: 0, feed: 0 };
    for (const tool of body.tools) tools[tool as CaravanTool]++;
    const petId = typeof body.petId === 'string' && body.petId ? body.petId : null;
    if (petId) {
        const pet = (Array.isArray(character.pets) ? character.pets as Obj[] : []).find(p => p.id === petId);
        if (!pet || petCombatBusyReason(character, pet, now)) throw new FestivalError('Choose an owned, available companion.');
    }
    const map = generateCaravanMap(daily.seed, contract, daily.weather);
    if (tools.map) for (const node of map) if (node.layer <= (daily.weather === 'sandstorm' ? 1 : 2)) node.revealed = true;
    progress.current = {
        id: randomUUID(), day, seed: daily.seed, version: 1, contract, weather: daily.weather, map,
        currentNodeId: null, available: map.filter(n => n.layer === 0).map(n => n.id), visited: [], status: 'travel',
        cargo: 100, supplies: contract.supplies, morale: daily.weather === 'night' ? 75 : 65, tools, flags: [], discoveries: [],
        reputation: 0, bonus: 0, enemiesDefeated: 0, travelersHelped: 0, selectedPetId: petId,
        baseReward: Math.round(dailyLoginRyo(Number(character.level) || 1) * contract.payoutFactor),
        log: [], combat: null, result: null, lastAction: null, createdAt: now, updatedAt: now,
    };
    progress.lastEntryDay = day;
    return { ...character, sunscarCaravan: progress };
}
function applyVitals(character: Obj, effect: CaravanEffect, morale: number): Obj {
    const next = { ...character };
    for (const [field, percent] of [['hp', effect.hpPercent], ['chakra', effect.chakraPercent], ['stamina', effect.staminaPercent]] as const) {
        if (!percent) continue;
        const max = Math.max(0, Number(character[`max${field[0].toUpperCase()}${field.slice(1)}`]) || 0);
        const recovery = percent > 0 ? (morale >= 80 ? 1.15 : morale < 25 ? .8 : 1) : 1;
        // Non-combat choices can exhaust you, but standard combat owns knockout/admission.
        next[field] = clamp((Number(character[field]) || 0) + Math.round(max * percent * recovery / 100), field === 'hp' ? 1 : 0, max);
    }
    return next;
}
export function finishCaravan(character: Obj, progress: CaravanProgress, reason: string, success: boolean, now: number): Obj {
    const run = progress.current!;
    if (run.result) return character;
    const objectiveComplete = success && caravanObjectiveComplete(run);
    const reputation = success ? Math.max(5, 10 + run.contract.difficulty * 5 + run.reputation + (objectiveComplete ? 5 : 0)) : Math.max(0, Math.floor(run.reputation / 2));
    const ryo = success ? Math.floor(run.baseReward * run.cargo / 100 * (1 + run.bonus / 100 + (objectiveComplete ? .1 : 0))) : 0;
    run.status = success ? 'complete' : 'failed';
    run.result = { ryo, reputation, cargo: run.cargo, objectiveComplete, reason };
    run.updatedAt = now;
    progress.reputation += reputation;
    if (success) progress.deliveries++;
    if (success && run.contract.chain) progress.chains[run.contract.chain.id] = Math.max(progress.chains[run.contract.chain.id] ?? 0, run.contract.chain.stage);
    progress.discoveries = [...new Set([...progress.discoveries, ...run.discoveries])];
    progress.history = [{ id: run.id, title: run.contract.title, day: run.day, result: run.result }, ...progress.history].slice(0, 12);
    return { ...character, ryo: (Number(character.ryo) || 0) + ryo, sunscarCaravan: progress, serverTitles: grantFestivalTitles(character, 'caravan', progress.reputation) };
}
export function advanceCaravan(character: Obj, body: Obj, now: number): { character: Obj; replay: boolean; petTrail: boolean } {
    const { progress, run } = requireCaravan(character, body.runId);
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    if (!/^[A-Za-z0-9_-]{8,96}$/.test(requestId)) throw new FestivalError('A stable request ID is required.');
    const fingerprint = JSON.stringify([body.action, body.nodeId, body.choiceId]);
    if (run.lastAction?.requestId === requestId) {
        if (run.lastAction.fingerprint !== fingerprint) throw new FestivalError('That request was already used for a different choice.', 409);
        return { character, replay: true, petTrail: false };
    }
    if (run.version !== body.version) throw new FestivalError('The caravan has moved. Reload your expedition before choosing again.', 409);
    if (run.result) throw new FestivalError('This contract has already ended.', 409);
    if (body.action !== 'retire' && (isIncapacitated(character) || Number(character.hp) <= 0)) throw new FestivalError('Recover at the hospital before continuing your escort.', 409);
    if (run.petEncounter?.state === 'pending') throw new FestivalError('Finish the wild companion encounter before moving on.', 409);
    let next = character, updated = run, effect: CaravanEffect = {};
    try {
        if (body.action === 'travel') updated = selectCaravanNode(run, String(body.nodeId));
        else if (body.action === 'choose') {
            const resolved = resolveCaravanChoice(run, String(body.choiceId), Number(character.ryo) || 0);
            updated = resolved.run; effect = resolved.effect;
            next = applyVitals({ ...character, ryo: (Number(character.ryo) || 0) - resolved.costRyo }, effect, run.morale);
            if (effect.combat) updated.combat = { sessionId: `caravan:${run.id}:${run.currentNodeId}`, enemy: effect.combat, nodeId: run.currentNodeId!, settled: false };
            if (effect.petTrail) updated.petEncounter = { requestId: `caravan_${run.id.replace(/-/g, '')}_${run.currentNodeId}`, state: 'pending' };
        } else if (body.action === 'retire') {
            if (run.status === 'combat') throw new FestivalError('Leave the battle through the normal combat controls first.', 409);
            updated = structuredClone(run);
            updated.cargo = 0;
        } else throw new FestivalError('Unknown caravan action.');
    } catch (error) { if (error instanceof FestivalError) throw error; throw new FestivalError(error instanceof Error ? error.message : 'This choice is unavailable.'); }
    updated.version++;
    updated.updatedAt = now;
    updated.lastAction = { requestId, fingerprint };
    progress.current = updated;
    next = { ...next, sunscarCaravan: progress };
    if (updated.cargo <= 0) next = finishCaravan(next, progress, body.action === 'retire' ? 'The convoy returned to Sunscar before delivery.' : 'No deliverable cargo remains.', false, now);
    else if (currentCaravanNode(updated)?.kind === 'destination') next = finishCaravan(next, progress, 'The receiver checked the manifest and accepted the delivered cargo.', true, now);
    return { character: next, replay: false, petTrail: effect.petTrail === true };
}
export function settleCaravanCombat(character: Obj, sessionId: string, won: boolean, now: number): Obj {
    const { progress, run } = requireCaravan(character);
    if (!run.combat || run.combat.sessionId !== sessionId) throw new FestivalError('This battle does not belong to the active expedition.', 409);
    if (run.combat.settled) return character;
    run.combat.settled = true;
    run.version++;
    run.updatedAt = now;
    if (!won) return finishCaravan(character, progress, 'The escort was defeated. The crew withdrew with the remaining cargo.', false, now);
    run.enemiesDefeated++;
    run.reputation += run.combat.enemy === 'raider' ? 2 : 4;
    run.morale = Math.min(100, run.morale + 5);
    run.status = 'travel';
    run.available = [...currentCaravanNode(run)!.next];
    run.log.push({ nodeId: run.currentNodeId!, title: 'The road is open', text: 'The crew checks the wagons while you recover your equipment. Your remaining combat condition carries into the journey.', cargo: run.cargo, supplies: run.supplies, morale: run.morale });
    return { ...character, sunscarCaravan: progress };
}
