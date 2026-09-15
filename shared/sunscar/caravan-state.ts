import { caravanEvent, CARAVAN_EVENTS } from './caravan-events.js';
import { clamp, sunscarHash, sunscarRandom } from './random.js';
import type { CaravanChoice, CaravanEffect, CaravanNode, CaravanRun } from './caravan-types.js';

export function currentCaravanNode(run: CaravanRun): CaravanNode | null { return run.map.find(n => n.id === run.currentNodeId) ?? null; }
export function caravanChoiceBlock(run: CaravanRun, choice: CaravanChoice, ryo: number): string | null {
    if (choice.requiresFlag && !run.flags.includes(choice.requiresFlag)) return 'A clue from an earlier encounter is needed.';
    if (choice.excludesFlag && run.flags.includes(choice.excludesFlag)) return 'This route is no longer available.';
    if ((choice.cost?.supplies ?? 0) > run.supplies) return `Requires ${choice.cost!.supplies} supplies.`;
    if (choice.cost?.tool && run.tools[choice.cost.tool] < 1) return `Requires ${choice.cost.tool}.`;
    const price = Math.ceil((choice.cost?.ryoFraction ?? 0) * run.baseReward);
    if (ryo < price) return `Requires ${price.toLocaleString()} Ryo.`;
    return null;
}
export function revealCaravan(run: CaravanRun, extra = 0): void {
    const layer = currentCaravanNode(run)?.layer ?? -1;
    const range = (run.weather === 'sandstorm' ? 1 : 2) + (run.tools.map > 0 ? 1 : 0) + extra;
    for (const node of run.map) if (node.layer <= layer + range) node.revealed = true;
}
export function caravanObjectiveComplete(run: CaravanRun): boolean {
    const objective = run.contract.objective;
    return (objective.kind === 'cargo' ? run.cargo : objective.kind === 'help' ? run.travelersHelped : objective.kind === 'combat' ? run.enemiesDefeated : run.discoveries.length) >= objective.target;
}
export function selectCaravanNode(source: CaravanRun, nodeId: string): CaravanRun {
    if (source.status !== 'travel' || !source.available.includes(nodeId) || source.visited.includes(nodeId)) throw new Error('Choose one of the connected roads ahead.');
    const run = structuredClone(source);
    const node = run.map.find(n => n.id === nodeId)!;
    run.currentNodeId = node.id;
    run.visited.push(node.id);
    run.available = [];
    let cost = 1;
    if (run.weather === 'heat' && run.visited.length % 3 === 0 && !run.tools.water) cost++;
    if (run.morale < 25 && run.visited.length % 3 === 0) cost++;
    const shortfall = Math.max(0, cost - run.supplies);
    run.supplies = Math.max(0, run.supplies - cost);
    if (shortfall) { run.cargo = Math.max(0, run.cargo - shortfall * 5); run.morale = Math.max(0, run.morale - shortfall * 3); }
    if (node.kind !== 'destination') {
        // Pay off an earlier decision at the first eligible later encounter,
        // never replace a contract boss or the next mandatory dangerous leg.
        if (['event', 'traveler', 'merchant', 'camp'].includes(node.kind)) {
            const continuation = CARAVAN_EVENTS.find(e => e.requiresFlag && run.flags.includes(e.requiresFlag)
                && !run.visited.some(id => id !== node.id && run.map.find(n => n.id === id)?.eventId === e.id));
            if (continuation) { node.eventId = continuation.id; node.kind = continuation.kind; }
        }
        run.status = 'encounter';
    }
    revealCaravan(run);
    if (shortfall) run.log.push({ nodeId, title: 'Supplies exhausted', text: `The crew improvised without ${shortfall} needed supply. ${shortfall * 5}% cargo was damaged.`, cargo: run.cargo, supplies: run.supplies, morale: run.morale });
    return run;
}
export function resolveCaravanChoice(source: CaravanRun, choiceId: string, ryo: number): { run: CaravanRun; effect: CaravanEffect; costRyo: number; text: string } {
    if (source.status !== 'encounter') throw new Error('Resolve the current road before choosing an encounter.');
    const node = currentCaravanNode(source);
    if (!node) throw new Error('The active encounter could not be found.');
    const event = caravanEvent(node.eventId);
    const choice = event.choices.find(c => c.id === choiceId);
    if (!choice) throw new Error('Choose an available response.');
    const blocked = caravanChoiceBlock(source, choice, ryo);
    if (blocked) throw new Error(blocked);
    const run = structuredClone(source);
    const costRyo = Math.ceil((choice.cost?.ryoFraction ?? 0) * run.baseReward);
    run.supplies -= choice.cost?.supplies ?? 0;
    if (choice.cost?.tool) run.tools[choice.cost.tool]--;
    let effect = structuredClone(choice.effect), text = choice.result;
    if (choice.outcomes?.length) {
        const rand = sunscarRandom(sunscarHash(`${run.seed}:${node.id}:${choice.id}`));
        let roll = rand() * choice.outcomes.reduce((sum, o) => sum + o.weight, 0);
        const outcome = choice.outcomes.find(o => (roll -= o.weight) < 0) ?? choice.outcomes[choice.outcomes.length - 1];
        effect = { ...effect, ...outcome.effect }; text = outcome.result;
    }
    const cargoDelta = effect.cargo ?? 0;
    run.cargo = clamp(run.cargo + (cargoDelta < 0 && run.morale >= 80 ? Math.ceil(cargoDelta * .85) : cargoDelta), 0, 100);
    const offeredSupplies = Math.max(0, effect.supplies ?? 0);
    const suppliesThatFit = Math.min(offeredSupplies, Math.max(0, 30 - run.supplies));
    run.supplies = clamp(run.supplies + (effect.supplies ?? 0), 0, 30);
    if (offeredSupplies > suppliesThatFit) text += ` Only ${suppliesThatFit} of ${offeredSupplies} extra supplies fit in the wagons (30 maximum).`;
    run.morale = clamp(run.morale + (effect.morale ?? 0), 0, 100);
    run.reputation += effect.reputation ?? 0;
    run.bonus = clamp(run.bonus + (effect.bonus ?? 0), -30, 30);
    if (effect.addFlags?.includes('helped-traveler')) run.travelersHelped++;
    run.flags = [...new Set([...run.flags, ...effect.addFlags ?? []])].filter(f => !effect.removeFlags?.includes(f));
    if (effect.discovery && !run.discoveries.includes(effect.discovery)) run.discoveries.push(effect.discovery);
    for (const [tool, count] of Object.entries(effect.tools ?? {})) run.tools[tool as keyof typeof run.tools] = clamp(run.tools[tool as keyof typeof run.tools] + count, 0, 5);
    revealCaravan(run, effect.scout ?? 0);
    run.status = effect.combat ? 'combat' : 'travel';
    run.available = effect.combat ? [] : [...node.next];
    run.log.push({ nodeId: node.id, title: event.title, text, cargo: run.cargo, supplies: run.supplies, morale: run.morale });
    return { run, effect, costRyo, text };
}
