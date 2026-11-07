import { randomInt } from 'node:crypto';
import { addOwned, countOwned, removeOwned } from '../craft/_forge.js';
import { gatheringTool, gatheringToolRemaining, useGatheringTool } from '../../shared/gathering-tools.js';
import { resourceNode, validResourceNodeTerrain, type GatherFamily, type GatherTrace, type ResourceNode } from '../../shared/resource-nodes.js';
import { readResourceGathering, resourceSkillLevel, resourceSuccessRate, resourceQuality, resourceItemId,
    resourceAttemptsToday, DAILY_RESOURCE_ATTEMPT_LIMIT, RESOURCE_SUCCESS_XP, RESOURCE_FAILURE_XP, RESOURCE_ACTIVITY_INFO,
    resourceNodeState, RESOURCE_ATTEMPT_MS, RESOURCE_REFILL_MS, type ResourcePublicAttempt,
    type ResourceReceipt, type ResourceFamily, type ResourceGrade } from '../../shared/resource-gathering.js';
import { fractureTemplatePool, solveFractureChain } from '../../shared/fracture-chain.js';
import { scoreFishing } from '../../shared/fishing-game.js';
import { scoreKunaiFishing, kunaiSeed } from '../../shared/kunai-fishing.js';
import { scoreKamaReaping, kamaSeed, type KamaCutTally } from '../../shared/kama-reaping.js';
import { harvestPayout, isHarvestCommonId, type HarvestNodeLevel, type HarvestTraceId } from '../../shared/harvesting.js';
import type { OnlinePlayer } from '../_realtime/types.js';

export type ResourceSeal = ResourcePublicAttempt & {
    sharedNode?: true;
    successDraw: number; qualityDraw: number; traceDraw: number; toolBroke: boolean; authorityEpoch: number;
    worldBossEventId?: string;
    rules: { version: 1 | 2; difficulty: number; ceiling: ResourceGrade; family: GatherFamily; trace?: GatherTrace };
};
/** Kama Reaping fields: any template in this range seeds a distinct field. */
const KAMA_TEMPLATES = 1000;
export const resourceDraw = () => randomInt(0, 1_000_000_000) / 1_000_000_000;
export function resourcePositionError(player: OnlinePlayer | null, node: ResourceNode) {
    if (!player || player.locationUnverified) return 'Connect to the world before gathering.';
    if (player.inBattle || (player.travelingUntil ?? 0) > Date.now()) return 'Finish your battle or travel first.';
    if (player.sector !== node.sector || player.tile !== node.approach) return 'Walk to the marked shore or rock base first.';
    return null;
}
export function resourceAdmissionError(character: Record<string, unknown>, node: ResourceNode, now: number, shared = false) {
    if (!validResourceNodeTerrain(node)) return 'This gathering spot is no longer available.';
    if (node.dormant) return 'Nothing is growing here right now. Wild plants spring up somewhere new every half hour.';
    const state = readResourceGathering(character.resourceGathering);
    if (state.active) return 'Finish or cancel your current gathering attempt first.';
    if (character.hospitalized) return 'Leave the hospital before gathering.';
    const info = RESOURCE_ACTIVITY_INFO[node.activity];
    if (!info) return 'This gathering spot is no longer available.';
    if (resourceSkillLevel(state[`${node.activity}Xp`]) < node.difficulty) return `Requires ${info.skill} skill ${node.difficulty}.`;
    if (resourceAttemptsToday(character, node.activity, now) >= DAILY_RESOURCE_ATTEMPT_LIMIT)
        return `You have used all ${DAILY_RESOURCE_ATTEMPT_LIMIT} ${node.activity} attempts today. Resets at midnight UTC.`;
    if (!shared && resourceNodeState(state.nodes[node.id], now).attempts >= 3) return 'This node is empty. Return after it replenishes.';
    const id = (character.equipment as Record<string, string> | undefined)?.[info.slot];
    if (gatheringTool(id)?.slot !== info.slot || gatheringToolRemaining(character, id!) === 0) return `Equip a ${info.tool} in Inventory first.`;
    return null;
}
export function mintResourceSeal(character: Record<string, unknown>, node: ResourceNode, id: string, mode: 'active' | 'relaxed', player: OnlinePlayer, now: number, veinbreaking = true): ResourceSeal {
    const state = readResourceGathering(character.resourceGathering);
    // Tabs opened before deployment can only render the original three layouts.
    const templates = veinbreaking ? fractureTemplatePool(node.difficulty) : node.difficulty === 1 ? [0, 1] : [2];
    const slot = RESOURCE_ACTIVITY_INFO[node.activity].slot;
    // The kama field is seeded from hookAt + template (kamaSeed), like the kunai.
    const template = node.activity === 'harvesting' ? randomInt(KAMA_TEMPLATES) : templates[randomInt(templates.length)];
    return { id, nodeId: node.id, activity: node.activity, startedAt: now, expiresAt: now + RESOURCE_ATTEMPT_MS,
        mode, skillLevel: resourceSkillLevel(state[`${node.activity}Xp`]),
        toolId: gatheringTool((character.equipment as Record<string, string> | undefined)?.[slot])?.id,
        template, hookAt: 1800 + randomInt(0, 1200),
        ...(node.activity === 'fishing' ? { fishingStyle: 'kunai' as const, fishingShoal: 'ranked' as const } : {}),
        ...(node.activity === 'harvesting' && isHarvestCommonId(node.family)
            ? { harvest: { family: node.family, ...(node.trace ? { trace: node.trace as HarvestTraceId } : {}) } } : {}),
        movementSequence: player.movementSeq ?? 0, authorityEpoch: player.resourceEpoch ?? 0,
        rules: { version: 2, difficulty: node.difficulty, ceiling: node.ceiling, family: node.family, trace: node.trace },
        successDraw: resourceDraw(), qualityDraw: resourceDraw(), traceDraw: resourceDraw(), toolBroke: false };
}
export function admitResourceAttempt(character: Record<string, unknown>, seal: ResourceSeal, now: number) {
    const node = resourceNode(seal.nodeId)!;
    const tool = useGatheringTool(character, RESOURCE_ACTIVITY_INFO[node.activity].slot);
    if (!tool) return null;
    const state = readResourceGathering(character.resourceGathering), prior = resourceNodeState(state.nodes[node.id], now);
    const attempts = prior.attempts + 1;
    const today = new Date(now).toISOString().slice(0, 10);
    return { ...tool.character, resourceGathering: { ...state, date: new Date(now).toISOString().slice(0, 10),
        miningAttemptsToday: (state.date === today ? state.miningAttemptsToday : 0) + (seal.activity === 'mining' ? 1 : 0),
        fishingAttemptsToday: (state.date === today ? state.fishingAttemptsToday : 0) + (seal.activity === 'fishing' ? 1 : 0),
        harvestingAttemptsToday: (state.date === today ? state.harvestingAttemptsToday : 0) + (seal.activity === 'harvesting' ? 1 : 0),
        attemptsToday: (state.date === new Date(now).toISOString().slice(0, 10) ? state.attemptsToday : 0) + 1,
        nodes: { ...state.nodes, [node.id]: { attempts, refillAt: attempts === 3 ? now + RESOURCE_REFILL_MS : 0 } },
        active: { id: seal.id, nodeId: seal.nodeId, activity: seal.activity, startedAt: seal.startedAt, expiresAt: seal.expiresAt,
            skillLevel: seal.skillLevel, mode: seal.mode, template: seal.template, hookAt: seal.hookAt,
            ...(seal.fishingStyle ? { fishingStyle: seal.fishingStyle } : {}),
            ...(seal.fishingShoal ? { fishingShoal: seal.fishingShoal } : {}),
            ...(seal.activity === 'mining' ? { deposit: (seal.rules.trace ?? seal.rules.family) as ResourceFamily } : {}),
            ...(seal.harvest ? { harvest: seal.harvest } : {}),
            movementSequence: seal.movementSequence, toolBroke: tool.broke, toolId: seal.toolId } } };
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
    if (rules.version !== 1 && rules.version !== 2 && !input.cancel) return { ok: false as const, error: 'This attempt uses unavailable rules. Cancel it to return to the map.' };
    const expired = now >= active.expiresAt;
    const interrupted = Boolean(resourcePositionError(player, node)) || (player ? player.movementSeq ?? 0 : -1) !== active.movementSequence
        || (player ? player.resourceEpoch ?? 0 : -1) !== active.authorityEpoch;
    let outcome: ResourceReceipt['outcome'] = expired ? 'expired' : input.cancel || interrupted ? 'cancelled' : 'failed';
    let performance = 0, gameFailed = false, fishingCatch: ResourceReceipt['fishingCatch'], harvestCuts: KamaCutTally | undefined;
    if (!expired && !input.cancel && !interrupted) {
        // Kunai and kama runs end when the player finishes, not on a timer.
        const selfPaced = active.mode === 'active' && (active.fishingStyle === 'kunai' || active.activity === 'harvesting');
        if (!selfPaced && now - active.startedAt < 2500) return { ok: false as const, error: 'The attempt is still playing. Try again in a moment.' };
        if (active.mode === 'active') {
            if (active.activity === 'harvesting') {
                const reaped = scoreKamaReaping(kamaSeed(active), input.events, now - active.startedAt);
                if (!reaped) return { ok: false as const, error: 'The harvest is still in progress. Finish your strokes before collecting.' };
                performance = reaped.performance; gameFailed = reaped.failed; harvestCuts = reaped.tally;
            } else if (active.activity === 'mining') {
                const solved = solveFractureChain(active.template, input.placements);
                if (!solved) return { ok: false as const, error: 'Place the required charges at different legal seams before detonating.' };
                performance = solved.performance; gameFailed = solved.destroyed;
            } else {
                const fishing = active.fishingStyle === 'kunai'
                    ? scoreKunaiFishing(kunaiSeed(active), input.events, now - active.startedAt, false, active.fishingShoal === 'ranked' ? active.skillLevel : undefined)
                    : scoreFishing(active.hookAt, input.events, now - active.startedAt);
                if (!fishing) return { ok: false as const, error: 'The fishing sequence is incomplete. Finish retrieving before resolving.' };
                performance = fishing.performance; gameFailed = fishing.failed;
                if ('catchInfo' in fishing) fishingCatch = fishing.catchInfo;
            }
        }
        if (!gameFailed && ((active.fishingStyle === 'kunai' && active.mode === 'active')
            || active.successDraw * 100 < resourceSuccessRate(active.skillLevel, rules.difficulty, performance))) outcome = 'success';
    }
    const xp = outcome === 'success' ? (rules.version === 1 ? 10 : RESOURCE_SUCCESS_XP)
        : outcome === 'failed' ? (rules.version === 1 ? 3 : RESOURCE_FAILURE_XP) : 0;
    const settled = { id, activity: active.activity, outcome, xp, performance, toolBroke: active.toolBroke,
        ...(fishingCatch ? { fishingCatch } : {}),
        ...(harvestCuts ? { harvestCuts } : {}),
        ...(active.activity === 'mining' && outcome === 'failed' ? { miningFailure: gameFailed ? 'fracture' as const : 'extraction' as const } : {}),
        ...(node.worldBossCrystal && active.worldBossEventId ? { worldBossEventId: active.worldBossEventId } : {}), settledAt: now };
    let receipt: ResourceReceipt, next = character;
    if (active.activity === 'harvesting') {
        // Owner-approved table (shared/harvesting.ts), paid from the SEALED rules
        // and trace draw. Harvest ids are plain and ungraded.
        const payout = outcome === 'success' && isHarvestCommonId(rules.family) ? harvestPayout({
            family: rules.family, level: rules.difficulty as HarvestNodeLevel, trace: rules.trace as HarvestTraceId | undefined,
            performance, traceDraw: active.traceDraw }) : undefined;
        receipt = { ...settled, ...(payout ? { itemId: payout.itemId, count: payout.count } : {}) };
        if (payout) next = addOwned(next, payout.itemId, payout.count, true);
        if (payout?.traceId) { next = addOwned(next, payout.traceId, 1, true); receipt.traceId = payout.traceId; }
    } else {
        const grade = outcome === 'success' ? resourceQuality(active.skillLevel, rules.ceiling, active.qualityDraw) : undefined;
        const itemId = grade == null ? undefined : resourceItemId(rules.family as ResourceFamily, grade);
        receipt = { ...settled, itemId, grade };
        if (itemId) next = addOwned(next, itemId, 1, true);
        if (grade != null && rules.trace && active.traceDraw < .02) {
            const trace = resourceItemId(rules.trace as ResourceFamily, grade);
            next = addOwned(next, trace, 1, true); receipt.traceId = trace;
        }
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
