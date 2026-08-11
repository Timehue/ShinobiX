/**
 * Player-facing copy for every rejection code emitted by ordinary Solo PvE.
 *
 * Keep the transport/engine codes stable for authority and diagnostics, but do
 * not make players decipher those protocol names in the combat HUD.
 */
export const CANONICAL_SOLO_ACTION_REJECTION_CODES = [
    "duplicate-move-token",
    "stale-version",
    "session-done",
    "not-your-turn",
    "enemy-cannot-summon",
    "already-summoned",
    "no-companion",
    "no-space",
    "cannot-act",
    "invalid-move",
    "occupied",
    "out-of-range",
    "no-stamina",
    "no-chakra",
    "no-jutsu",
    "no-weapon",
    "on-cooldown",
    "out-of-item",
    "no-item",
    "retreat-sealed",
    "unknown-action",
    "elementally-sealed",
    "target-tile-required",
    "invalid-move-target",
    "invalid-ground-target",
    "ground-effect-needs-supported-tag",
    "rejected",
] as const;

export type SoloActionRejectionCode = typeof CANONICAL_SOLO_ACTION_REJECTION_CODES[number];

export const SOLO_ACTION_REJECTION_COPY: Readonly<Record<SoloActionRejectionCode, string>> = {
    "duplicate-move-token": "That action was already received. Your battle state has been refreshed.",
    "stale-version": "The battle changed before that action arrived. Try again from the refreshed state.",
    "session-done": "This battle has already ended.",
    "not-your-turn": "Wait for your turn before choosing an action.",
    "enemy-cannot-summon": "Only your ninja can summon a companion.",
    "already-summoned": "Your companion has already been summoned in this battle.",
    "no-companion": "No companion is available to summon.",
    "no-space": "There is no open adjacent tile for your companion.",
    "cannot-act": "You need more AP, another action slot, or for this action to finish cooling down.",
    "invalid-move": "Choose a highlighted adjacent tile to move.",
    "occupied": "That tile is blocked or already occupied.",
    "out-of-range": "Move closer or choose a target inside this action's range.",
    "no-stamina": "You do not have enough Stamina (SP) for that action.",
    "no-chakra": "You do not have enough Chakra (CP) for that action.",
    "no-jutsu": "That jutsu is not available in your sealed combat loadout.",
    "no-weapon": "That weapon is not available in your sealed combat loadout.",
    "on-cooldown": "That action is still on cooldown.",
    "out-of-item": "You have no charges left for that item.",
    "no-item": "That item is not available in your sealed combat loadout.",
    "retreat-sealed": "Retreat is sealed for this battle.",
    "unknown-action": "That action is not available in this battle.",
    "elementally-sealed": "Elemental Seal prevents you from using that jutsu right now.",
    "target-tile-required": "Choose a highlighted target tile for that jutsu.",
    "invalid-move-target": "Choose an open highlighted tile within the jutsu's movement range.",
    "invalid-ground-target": "Choose an open highlighted tile within the jutsu's range.",
    "ground-effect-needs-supported-tag": "That jutsu cannot create a valid combat zone right now.",
    "rejected": "That action is not available right now.",
};

const MACHINE_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const DEFAULT_REJECTION_COPY = "That action is not available right now.";

export function presentSoloActionRejection(reason: string | null | undefined): string {
    const trimmed = reason?.trim();
    if (!trimmed) return DEFAULT_REJECTION_COPY;

    const code = trimmed.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(SOLO_ACTION_REJECTION_COPY, code)) {
        return SOLO_ACTION_REJECTION_COPY[code as SoloActionRejectionCode];
    }

    // Preserve already-readable server/network errors, while ensuring a future
    // protocol code never leaks into the player-facing alert before copy lands.
    return MACHINE_CODE.test(code) ? DEFAULT_REJECTION_COPY : trimmed;
}
