/** Both exhibition clients must receive the roster frozen on acceptance. The
 * responder's local save and original invitation may already be out of date. */
export function warfrontMatchFromNotice(notice: Record<string, unknown>) {
    if (notice.arenaMatch !== true || notice.accepted !== true) return null;
    const challenger = notice.challenger as { pets?: Array<Record<string, unknown>> } | undefined;
    const ids = Array.isArray(notice.challengerTeamIds) ? notice.challengerTeamIds : [];
    const blue = ids.map((id) => challenger?.pets?.find((pet) => pet.id === id)).filter(Boolean) as Array<Record<string, unknown>>;
    const red = Array.isArray(notice.responderTeam) ? notice.responderTeam as Array<Record<string, unknown>> : [];
    if (blue.length !== 4 || red.length !== 4
        || new Set(blue.map((pet) => pet.id)).size !== 4 || new Set(red.map((pet) => pet.id)).size !== 4
        || !Number.isSafeInteger(notice.petBattleSeed) || Number(notice.petBattleSeed) <= 0
        || !notice.challengerWarfrontPlan || !notice.responderWarfrontPlan) return null;
    return {
        blue, red, size: 4 as const, seed: Number(notice.petBattleSeed),
        plans: { blue: notice.challengerWarfrontPlan, red: notice.responderWarfrontPlan },
    };
}
