const SAFE_PRACTICE_PROFILES = [
    { id: "builtin-ai-academy-sparring", level: 3 },
    { id: "builtin-ai-mist-sentinel", level: 8 },
    { id: "builtin-ai-ember-duelist", level: 18 },
    { id: "builtin-ai-exam-proctor", level: 25 },
    { id: "builtin-ai-frost-sealer", level: 32 },
    { id: "builtin-ai-rogue-ninja", level: 47 },
    { id: "builtin-ai-shadow-weaver", level: 48 },
    { id: "builtin-ai-central-champion", level: 70 },
] as const;

export type CreatorEventPracticeOpponent = {
    id: string;
    authored: boolean;
};

export function publishedPracticeOpponentForLevel(playerLevel: number): string {
    const level = Math.max(1, Math.floor(Number(playerLevel) || 1));
    return SAFE_PRACTICE_PROFILES.reduce((best, candidate) => (
        Math.abs(candidate.level - level) < Math.abs(best.level - level) ? candidate : best
    )).id;
}

/**
 * Creator-event combat has no server-sealed event-reward receipt yet. It may
 * therefore launch only a published practice profile. Older road choices did
 * not save an aiProfileId, so they receive a deterministic built-in opponent
 * near the player's level instead of recreating a client-authoritative temp AI.
 */
export function creatorEventPracticeOpponent(
    eventAiProfileId: string | undefined,
    battleAiProfileId: string | undefined,
    playerLevel: number,
): CreatorEventPracticeOpponent {
    const authored = battleAiProfileId?.trim() || eventAiProfileId?.trim();
    if (authored) return { id: authored, authored: true };
    return { id: publishedPracticeOpponentForLevel(playerLevel), authored: false };
}

export const creatorEventPracticeProfileIds = SAFE_PRACTICE_PROFILES.map(({ id }) => id);
