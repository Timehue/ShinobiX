export const STORY_RECKONING_DAILY_CAP = 3;

export type StoryReckoningMetric = "totalAiKills" | "totalTilesExplored";
export type StoryReckoningSeal = { id: string; stage: "task" | "return"; baseline: number; at: number };

export interface StoryReckoningDef {
    id: string;
    village: string;
    levelReq: number;
    ownProgress: number;
    completionTrait: string;
    metric: StoryReckoningMetric;
    target: number;
    dropItemId: string;
    weight: number;
    fateShards: number;
    title: string;
}

export const STORY_RECKONINGS: Record<string, StoryReckoningDef> = {
    "story-reckoning-vanta-ninth": {
        id: "story-reckoning-vanta-ninth",
        village: "Stormveil Village",
        levelReq: 58,
        ownProgress: 5,
        completionTrait: "svr-vanta-ninth-closed",
        metric: "totalAiKills",
        target: 1,
        dropItemId: "event-kesa-storm-seal",
        weight: 6,
        fateShards: 1,
        title: "Storm-Witness",
    },
    "story-reckoning-mira-marker": {
        id: "story-reckoning-mira-marker",
        village: "Stormveil Village",
        levelReq: 25,
        ownProgress: 3,
        completionTrait: "svr-mira-marker-set",
        metric: "totalTilesExplored",
        target: 12,
        dropItemId: "event-kesa-marker",
        weight: 4,
        fateShards: 0,
        title: "Ridge-Walker",
    },
};

const clampLevel = (n: unknown) => Math.max(1, Math.min(100, Math.floor(Number(n) || 0) || 1));

export function isStoryReckoningId(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(STORY_RECKONINGS, id);
}

export function parseStoryReckoningSeal(raw: unknown): StoryReckoningSeal | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : '';
    const stage = value.stage === 'task' || value.stage === 'return' ? value.stage : null;
    const baseline = Number(value.baseline);
    const at = Number(value.at ?? 0);
    if (!isStoryReckoningId(id) || !stage || !Number.isFinite(baseline) || !Number.isSafeInteger(at) || at < 0) return null;
    return { id, stage, baseline, at };
}

export function storyReckoningRyo(level: unknown, weight: number): number {
    return Math.round(weight * (40 + clampLevel(level) * 5));
}

export function storyReckoningTaskComplete(baseline: unknown, current: unknown, target: number): boolean {
    return (Number(current) || 0) - (Number(baseline) || 0) >= Math.max(1, target);
}

export function storyReckoningEligible(
    char: { level?: unknown; storyVillage?: unknown; storyProgress?: unknown; storyTraits?: unknown },
    def: StoryReckoningDef,
): boolean {
    const traits = Array.isArray(char.storyTraits) ? (char.storyTraits as unknown[]).map(String) : [];
    if (traits.includes(def.completionTrait)) return false;
    if ((Number(char.level) || 0) < def.levelReq) return false;
    if (char.storyVillage !== def.village) return false;
    return (Number(char.storyProgress) || 0) >= def.ownProgress;
}

export function ownedItemCount(char: { inventory?: unknown; itemStacks?: unknown }, itemId: string): number {
    let count = 0;
    if (Array.isArray(char.inventory)) {
        for (const entry of char.inventory) if (entry === itemId) count += 1;
    }
    if (Array.isArray(char.itemStacks)) {
        for (const stack of char.itemStacks as Array<{ itemId?: unknown; count?: unknown }>) {
            if (stack?.itemId === itemId) count += Math.max(0, Math.floor(Number(stack.count) || 0));
        }
    }
    return count;
}
