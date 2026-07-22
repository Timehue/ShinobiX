export const STORY_RECKONING_DAILY_CAP = 3;

export type StoryReckoningMetric = "totalAiKills" | "totalTilesExplored";
export type StoryReckoningSeal = { id: string; stage: "task" | "return"; baseline: number; at: number };

export interface StoryReckoningDef {
    id: string;
    village: string;
    /** Stands at ANY village's outskirts once the player has reached ownProgress
     *  (gated on progress/level, not storyVillage). `village` is placeholder only. */
    crossVillage?: boolean;
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
    "story-reckoning-toma-cinders": {
        id: "story-reckoning-toma-cinders",
        village: "Ashen Leaf Village",
        levelReq: 30,
        ownProgress: 3,
        completionTrait: "alr-toma-cinders-read",
        metric: "totalTilesExplored",
        target: 12,
        dropItemId: "event-reed-tally",
        weight: 4,
        fateShards: 0,
        title: "Name-Keeper",
    },
    "story-reckoning-mori-working-copy": {
        id: "story-reckoning-mori-working-copy",
        village: "Ashen Leaf Village",
        levelReq: 58,
        ownProgress: 5,
        completionTrait: "alr-mori-copy-set",
        metric: "totalAiKills",
        target: 1,
        dropItemId: "event-struck-nameplate",
        weight: 6,
        fateShards: 1,
        title: "Ash-Witness",
    },
    "story-reckoning-sova-true-roll": {
        id: "story-reckoning-sova-true-roll",
        village: "Frostfang Village",
        levelReq: 42,
        ownProgress: 4,
        completionTrait: "ffr-sova-roll-bound",
        metric: "totalTilesExplored",
        target: 12,
        dropItemId: "event-true-roll-page",
        weight: 5,
        fateShards: 0,
        title: "Roll-Reader",
    },
    "story-reckoning-yura-exemption": {
        id: "story-reckoning-yura-exemption",
        village: "Frostfang Village",
        levelReq: 58,
        ownProgress: 5,
        completionTrait: "ffr-yura-token-returned",
        metric: "totalAiKills",
        target: 1,
        dropItemId: "event-struck-warmth-token",
        weight: 6,
        fateShards: 1,
        title: "Oath-Witness",
    },
    "story-reckoning-nyx-ledger": {
        id: "story-reckoning-nyx-ledger",
        village: "Moonshadow Village",
        levelReq: 30,
        ownProgress: 3,
        completionTrait: "msr-nyx-ledger-open",
        metric: "totalTilesExplored",
        target: 12,
        dropItemId: "event-unsworn-page",
        weight: 4,
        fateShards: 0,
        title: "Buyer-Namer",
    },
    "story-reckoning-iro-sealed-shelf": {
        id: "story-reckoning-iro-sealed-shelf",
        village: "Moonshadow Village",
        levelReq: 58,
        ownProgress: 5,
        completionTrait: "msr-iro-shelf-unsealed",
        metric: "totalAiKills",
        target: 1,
        dropItemId: "event-sealed-file",
        weight: 6,
        fateShards: 1,
        title: "Shelf-Breaker",
    },
    "story-reckoning-harrow-unbought": {
        id: "story-reckoning-harrow-unbought",
        village: "Stormveil Village",
        crossVillage: true,
        levelReq: 65,
        ownProgress: 9,
        completionTrait: "hr-harrow-contract-closed",
        metric: "totalAiKills",
        target: 1,
        dropItemId: "event-forged-die",
        weight: 7,
        fateShards: 2,
        title: "The Unbought",
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
    if ((Number(char.storyProgress) || 0) < def.ownProgress) return false;
    // Cross-village figures ignore storyVillage; own-village arcs require the match.
    return def.crossVillage === true || char.storyVillage === def.village;
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
