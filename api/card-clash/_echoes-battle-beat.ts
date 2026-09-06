import {
    getChronicleCard,
    type ChronicleMatch,
    type ChroniclePresentationEvent,
    type ChronicleSideKey,
} from "../../shared/chronicle-duel.js";
import type { EchoesBattleBeat } from "../../shared/echoes-witness.js";

const ATTACK_DENIAL_EFFECTS = new Set(["negateOneAttack", "negateAttackAndInflictDamage"]);

function isAttackDenial(event: ChroniclePresentationEvent, player: ChronicleSideKey): boolean {
    if (event.kind !== "trap-activated" || event.actor !== player || !event.cardId) return false;
    const card = getChronicleCard(event.cardId) as { effect?: { kind?: unknown } } | undefined;
    return ATTACK_DENIAL_EFFECTS.has(String(card?.effect?.kind ?? ""));
}

/**
 * Derive one bounded presentation callback from the authoritative match event
 * stream. The summary is descriptive only: it changes no reward, unlock, or
 * combat state. Older sessions without structured events use the neutral beat.
 */
export function echoesBattleBeatForMatch(
    match: Pick<ChronicleMatch, "events">,
    player: ChronicleSideKey = "p1",
): EchoesBattleBeat {
    const events = Array.isArray(match.events) ? match.events : [];
    if (events.some((event) => isAttackDenial(event, player))) return "denied-attack";

    let tookDamage = false;
    for (const event of events) {
        if (event.kind === "damage" && event.side === player) tookDamage = true;
        if (tookDamage && event.kind === "healing" && event.side === player) return "recovered-ground";
    }

    let lostCard = false;
    for (const event of events) {
        if (event.kind === "card-destroyed" && event.side === player) lostCard = true;
        if (lostCard && event.kind === "monster-summoned" && event.actor === player) return "rebuilt-line";
    }
    return "unrecorded";
}
