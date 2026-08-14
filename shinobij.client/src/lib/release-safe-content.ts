import type { CreatorEvent } from "../types/vn";

/**
 * Client-authored events are public only while they are presentation-only.
 * Rewards, progression traits, battles, and Kage finales need an authoritative
 * server catalog and settlement before they can be exposed to players.
 */
export function isReleaseSafeClientEvent(event: CreatorEvent): boolean {
    if (event.eventKind !== "visualNovel" || event.kageFinale) return false;
    if (Number(event.xpReward ?? 0) !== 0 || Number(event.ryoReward ?? 0) !== 0 || Number(event.staminaReward ?? 0) !== 0) return false;
    if (Object.values(event.currencyRewards ?? {}).some(value => Number(value ?? 0) !== 0)) return false;
    return !(event.vnPages ?? []).some(page => (page.choices ?? []).some(choice => Boolean(choice.battle || choice.trait)));
}
