import type { ShowdownPetView } from "./pet-showdown-api";
type ShowdownMoveView = ShowdownPetView["moves"][number];

const NON_HOSTILE_KINDS = new Set([
    "heal", "buff", "haste", "move", "shield", "barrier", "absorb", "taunt", "protect", "weather",
]);

/** Matchup badges describe the inspected attack, never the creature's skin or
 * native element. Utility actions and neutral attacks have no wheel hint. */
export function showdownMatchupElement(
    move: Pick<ShowdownMoveView, "element" | "kind" | "power"> | null | undefined,
    fallbackElement: string,
): string | undefined {
    if (!move || move.power <= 0 || NON_HOSTILE_KINDS.has(move.kind)) return undefined;
    const element = move.element ?? fallbackElement;
    return element === "None" ? undefined : element;
}
