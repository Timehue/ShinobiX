import { randomInt } from 'node:crypto';
import { addOwned, countOwned, removeOwned } from '../craft/_forge.js';
import { gatheringTool, gatheringToolRemaining, useGatheringTool } from '../../shared/gathering-tools.js';
import { resourceNode, type ResourceNode } from '../../shared/resource-nodes.js';
import { readResourceGathering, resourceSkillLevel, resourceSuccessRate, resourceQuality, resourceItemId,
    resourceActionsToday, resourceNodeState, RESOURCE_ATTEMPT_MS, RESOURCE_REFILL_MS, type ResourcePublicAttempt,
    type ResourceReceipt, type ResourceFamily, type ResourceGrade } from '../../shared/resource-gathering.js';
import { solveFractureChain } from '../../shared/fracture-chain.js';
import { scoreFishing } from '../../shared/fishing-game.js';
import type { OnlinePlayer } from '../_realtime/types.js';

export type ResourceSeal = ResourcePublicAttempt & {
    successDraw: number; qualityDraw: number; traceDraw: number; toolBroke: boolean; authorityEpoch: number;
    rules: { version: 1; difficulty: number; ceiling: ResourceGrade; family: ResourceFamily; trace?: ResourceFamily };
};
export const resourceDraw = () => randomInt(0, 1_000_000_000) / 1_000_000_000;
export function resourcePositionError(player: OnlinePlayer | null, node: ResourceNode) {
    if (!player || player.locationUnverified) return 'Connect to the world before gathering.';
    if (player.inBattle || (player.travelingUntil ?? 0) > Date.now()) return 'Finish your battle or travel first.';
    if (player.sector !== node.sector || player.tile !== node.approach) return 'Walk to the marked shore or rock base first.';
    return null;
}
export function resourceAdmissionError(character: Record<string, unknown>, node: ResourceNode, now: number) {
    const state = readResourceGathering(character.resourceGathering);
    if (state.active) return 'Finish or cancel your current gathering attempt first.';
    if (character.hospitalized) return 'Leave the hospital before gathering.';
    if (resourceSkillLevel(state[`${node.activity}Xp`]) < node.difficulty) return `Requires ${node.activity === 'mining' ? 'Mining' : 'Fishing'} skill ${node.difficulty}.`;
    if (resourceActionsToday(character, now) >= 100) return 'You have used all 100 Explore, Fishing and Mining actions today.';
    if (resourceNodeState(state.nodes[node.id], now).attempts >= 3) return 'This node is empty. Return after it replenishes.';
    const slot = node.activity === 'mining' ? 'pickaxe' : 'fishingPole';
    const id = (character.equipment as Record<string, string> | undefined)?.[slot];
    if (gatheringTool(id)?.slot !== slot || gatheringToolRemaining(character, id!) === 0) return `Equip a ${slot === 'pickaxe' ? 'pickaxe' : 'fishing pole'} in Inventory first.`;
    return null;
}
export function mintResourceSeal(character: Record<string, unknown>, node: ResourceNode, id: string, mode: 'active' | 'relaxed', player: OnlinePlayer, now: number): ResourceSeal {
    const state = readResourceGathering(character.resourceGathering);
    return { id, nodeId: node.id, activity: node.activity, startedAt: now, expiresAt: now + RESOURCE_ATTEMPT_MS,
        mode, skillLevel: resourceSkillLevel(state[`${node.activity}Xp`]),
        template: node.difficulty === 1 ? randomInt(0, 2) : 2, hookAt: 1800 + randomInt(0, 1200),
        movementSequence: player.movementSeq ?? 0, authorityEpoch: player.resourceEpoch ?? 0,
        rules: { version: 1, difficulty: node.difficulty, ceiling: node.ceiling, family: node.family, trace: node.trace },
        successDraw: resourceDraw(), qualityDraw: resourceDraw(), traceDraw: resourceDraw(), toolBroke: false };
}
export function admitResourceAttempt(character: Record<string, unknown>, seal: ResourceSeal, now: number) {
    const node = resourceNode(seal.nodeId)!;
    const tool = useGatheringTool(character, node.activity === 'mining' ? 'pickaxe' : 'fishingPole');
    if (!tool) return null;
    const state = readResourceGathering(character.resourceGathering), prior = resourceNodeState(state.nodes[node.id], now);
    const attempts = prior.attempts + 1;
    return { ...tool.character, resourceGathering: { ...state, date: new Date(now).toISOString().slice(0, 10),
        attemptsToday: (state.date === new Date(now).toISOString().slice(0, 10) ? state.attemptsToday : 0) + 1,
        nodes: { ...state.nodes, [node.id]: { attempts, refillAt: attempts === 3 ? now + RESOURCE_REFILL_MS : 0 } },
        active: { id: seal.id, nodeId: seal.nodeId, activity: seal.activity, startedAt: seal.startedAt, expiresAt: seal.expiresAt,
            skillLevel: seal.skillLevel, mode: seal.mode, template: seal.template, hookAt: seal.hookAt,
            movementSequence: seal.movementSequence, toolBroke: tool.broke } } };
}
export function resolveResourceAttempt(character: Record<string, unknown>, id: string, input: { cancel?: boolean; placements?: unknown; events?: unknown }, player: OnlinePlayer | null, now: number, seal?: ResourceSeal) {
    const state = readResourceGathering(character.resourceGathering);
    const prior = state.receipts.find(r => r.id === id);
    if (prior) return { ok: true as const, character, receipt: prior, replayed: true };
    const saved = state.active;
    if (!saved || saved.id !== id) return { ok: false as const, error: 'This gathering attempt is no longer active.' };
    const validSeal = seal?.id === id && seal.nodeId === saved.nodeId;
    if (!validSeal && !input.cancel && now < saved.expiresAt)
        return { ok: false as const, error: 'This attempt could not be recovered. Retry or cancel to return to the map.' };
    // The public save contains no reward draws. Only the server journal can
    // supply them; cancellation and expiry can still close a missing journal.
    const active = { ...(validSeal ? seal : saved), toolBroke: saved.toolBroke ?? false } as ResourceSeal;
    const node = resourceNode(active.nodeId)!;
    // Keep the admitted reward table across a deployment. The fallback only
    // covers short-lived attempts created before rule snapshots were added.
    const rules = active.rules ?? { version: 1, difficulty: node.difficulty, ceiling: node.ceiling, family: node.family, trace: node.trace };
    if (rules.version !== 1 && !input.cancel) return { ok: false as const, error: 'This attempt uses unavailable rules. Cancel it to return to the map.' };
    const expired = now >= active.expiresAt;
    const interrupted = Boolean(resourcePositionError(player, node)) || (player ? player.movementSeq ?? 0 : -1) !== active.movementSequence
        || (player ? player.resourceEpoch ?? 0 : -1) !== active.authorityEpoch;
    let outcome: ResourceReceipt['outcome'] = expired ? 'expired' : input.cancel || interrupted ? 'cancelled' : 'failed';
    let performance = 0, gameFailed = false;
    if (!expired && !input.cancel && !interrupted) {
        if (now - active.startedAt < 2500) return { ok: false as const, error: 'The attempt is still playing. Try again in a moment.' };
        if (active.mode === 'active') {
            if (active.activity === 'mining') {
                const solved = solveFractureChain(active.template, input.placements);
                if (!solved) return { ok: false as const, error: 'Place the required charges at different legal seams before detonating.' };
                performance = solved.performance; gameFailed = solved.destroyed;
            } else {
                const fishing = scoreFishing(active.hookAt, input.events, now - active.startedAt);
                if (!fishing) return { ok: false as const, error: 'The fishing sequence is incomplete. Finish reeling before resolving.' };
                performance = fishing.performance; gameFailed = fishing.failed;
            }
        }
        if (!gameFailed && active.successDraw * 100 < resourceSuccessRate(active.skillLevel, rules.difficulty, performance)) outcome = 'success';
    }
    const grade = outcome === 'success' ? resourceQuality(active.skillLevel, rules.ceiling, active.qualityDraw) : undefined;
    const itemId = grade == null ? undefined : resourceItemId(rules.family, grade);
    const xp = outcome === 'success' ? 10 : outcome === 'failed' ? 3 : 0;
    const receipt: ResourceReceipt = { id, activity: active.activity, outcome, itemId, grade, xp, performance, toolBroke: active.toolBroke, settledAt: now };
    let next = itemId ? addOwned(character, itemId, 1, true) : character;
    if (grade != null && rules.trace && active.traceDraw < .02) {
        const trace = resourceItemId(rules.trace, grade);
        next = addOwned(next, trace, 1, true); receipt.traceId = trace;
    }
    const { active: _active, ...rest } = state; void _active;
    return { ok: true as const, replayed: false, receipt, character: { ...next, resourceGathering: {
        ...rest, [`${active.activity}Xp`]: state[`${active.activity}Xp`] + xp, receipts: [...state.receipts, receipt].slice(-100),
    } } };
}
export function equipGatheringTool(character: Record<string, unknown>, id: unknown, unequip: unknown) {
    const tool = gatheringTool(id); if (!tool) return null;
    const state = readResourceGathering(character.resourceGathering); if (state.active) return null;
    const equipment = { ...(character.equipment as Record<string, string> ?? {}) };
    if (unequip === true) {
        if (equipment[tool.slot] !== tool.id) return character;
        delete equipment[tool.slot];
        return addOwned({ ...character, equipment }, tool.id, 1, false);
    }
    if (equipment[tool.slot] === tool.id) return character;
    if (countOwned(character, tool.id) < 1 || gatheringToolRemaining(character, tool.id) === 0) return null;
    let next = removeOwned(character, tool.id, 1);
    if (equipment[tool.slot]) next = addOwned(next, equipment[tool.slot], 1, false);
    equipment[tool.slot] = tool.id;
    return { ...next, equipment };
}
