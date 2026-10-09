/** Canonical rules shared by the Outpost, world nodes and authoritative settlement. */
import type { ResourceActivity, ResourceGrade } from './resource-items';
export { RESOURCE_GRADES, RESOURCE_FAMILIES, RESOURCE_ITEMS, resourceItemId } from './resource-items';
export type { ResourceActivity, ResourceGrade, ResourceFamily } from './resource-items';
export const RESOURCE_DAILY_LIMIT = 100;
export const RESOURCE_NODE_ATTEMPTS = 3;
export const RESOURCE_REFILL_MS = 10 * 60_000;
export const RESOURCE_ATTEMPT_MS = 90_000;
export const RESOURCE_SKILL_XP = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200] as const;
const whole = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
export function resourceSkillLevel(xp: unknown): number {
    const value = whole(xp);
    return RESOURCE_SKILL_XP.reduce<number>((level, threshold, i) => value >= threshold ? i + 1 : level, 1);
}
export const resourceGradeUnlock = (level: number): ResourceGrade => level >= 7 ? 3 : level >= 4 ? 2 : level >= 2 ? 1 : 0;
export function resourceSuccessRate(level: number, difficulty: number, performance = 0): number {
    return Math.min(95, Math.max(15, 60 + 5 * (level - difficulty) + Math.min(10, Math.max(0, performance))));
}
const QUALITY_ANCHORS = [
    { level: 1, weights: [100, 0, 0, 0] }, { level: 2, weights: [90, 10, 0, 0] },
    { level: 4, weights: [65, 25, 10, 0] }, { level: 7, weights: [40, 35, 20, 5] },
    { level: 10, weights: [15, 35, 35, 15] },
];
export function resourceQualityWeights(levelRaw: number, ceiling: ResourceGrade): number[] {
    const level = Math.min(10, Math.max(1, levelRaw));
    const low = [...QUALITY_ANCHORS].reverse().find(a => a.level <= level)!;
    const high = QUALITY_ANCHORS.find(a => a.level >= level)!;
    const blend = high.level === low.level ? 0 : (level - low.level) / (high.level - low.level);
    const weights = low.weights.map((w, i) => w + (high.weights[i] - w) * blend);
    const allowed = Math.min(ceiling, resourceGradeUnlock(level));
    for (let i = 3; i > allowed; i--) { weights[allowed] += weights[i]; weights[i] = 0; }
    return weights;
}
export function resourceQuality(level: number, ceiling: ResourceGrade, draw: number): ResourceGrade {
    let remaining = Math.min(0.999999999, Math.max(0, draw)) * 100;
    const weights = resourceQualityWeights(level, ceiling);
    for (let i = 0; i < weights.length; i++) { remaining -= weights[i]; if (remaining < 0) return i as ResourceGrade; }
    return 0;
}
export type ResourceNodeState = { attempts: number; refillAt: number };
export function resourceNodeState(state: ResourceNodeState | undefined, now: number): ResourceNodeState {
    return !state || (state.refillAt > 0 && now >= state.refillAt)
        ? { attempts: 0, refillAt: 0 } : { attempts: Math.min(3, whole(state.attempts)), refillAt: whole(state.refillAt) };
}
export type ResourcePublicAttempt = {
    id: string; nodeId: string; activity: ResourceActivity; startedAt: number; expiresAt: number;
    skillLevel: number; mode: 'active' | 'relaxed'; template: number; hookAt: number; movementSequence: number; toolBroke?: boolean;
};
export type ResourceReceipt = {
    id: string; activity: ResourceActivity; outcome: 'success' | 'failed' | 'cancelled' | 'expired';
    itemId?: string; grade?: ResourceGrade; xp: number; performance: number; toolBroke: boolean;
    traceId?: string;
    settledAt?: number;
};
export type ResourceGatheringState = {
    fishingXp: number; miningXp: number; date: string; attemptsToday: number;
    nodes: Record<string, ResourceNodeState>; active?: ResourcePublicAttempt; receipts: ResourceReceipt[];
};
export function readResourceGathering(value: unknown): ResourceGatheringState {
    const raw = (value && typeof value === 'object' ? value : {}) as Partial<ResourceGatheringState>;
    return { fishingXp: whole(raw.fishingXp), miningXp: whole(raw.miningXp), date: String(raw.date ?? ''),
        attemptsToday: whole(raw.attemptsToday), nodes: raw.nodes ?? {}, active: raw.active,
        receipts: Array.isArray(raw.receipts) ? raw.receipts.slice(-100) : [] };
}
export function resourceActionsToday(character: object, now = Date.now()): number {
    const c = character as Record<string, unknown>, day = new Date(now).toISOString().slice(0, 10);
    const state = readResourceGathering(c.resourceGathering);
    return (c.serverExploreDate === day ? whole(c.serverExploresToday) : 0) + (state.date === day ? state.attemptsToday : 0);
}
