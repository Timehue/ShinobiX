/*
 * chronicle-lock — DATA-FREE lock state for the Shinobi Chronicle card game.
 *
 * The card game stays sealed until the Chronicle Scribe event hands the player
 * their traveler's codex (lib/chronicle-scribe.ts sets `starterCardsClaimed`
 * via the server claim). Split from the scribe module rift-run-style so the
 * entry-bundle Shop component can gate its pack section without pulling the
 * scribe's VN content into every player's initial download.
 *
 * The server enforces the same lock on the player-initiated card surfaces
 * (api/card-clash/_starter-cards.ts `chronicleUnlocked`): AI duels, the PvP
 * queue, and both pack-purchase paths. War-embedded card systems stay open.
 */
import type { Character } from "../types/character";

/** Mirrors STARTER_CARDS_MIN_LEVEL in api/card-clash/_starter-cards.ts. */
export const SCRIBE_MIN_LEVEL = 17;

export type CardGameLockStatus = { locked: boolean; title: string; body: string };

/** Whether the Chronicle mode is sealed for this character, with the message
 *  the Card Hall / Shop show. Unlocks the moment Ihara hands over the codex. */
export function cardGameLockStatus(character: Pick<Character, "level" | "starterCardsClaimed">): CardGameLockStatus {
    if (character.starterCardsClaimed === true) return { locked: false, title: "", body: "" };
    if ((character.level ?? 0) < SCRIBE_MIN_LEVEL) {
        return {
            locked: true,
            title: "The Chronicle is sealed — for now",
            body: `The Chronicle scribes don't come looking for a shinobi until they've made a name on the road. Reach level ${SCRIBE_MIN_LEVEL}, and word is one of them will come looking for you.`,
        };
    }
    return {
        locked: true,
        title: "A scribe is asking after you",
        body: "Word around the tavern: an old Chronicle scribe named Ihara is walking the wild sectors with a heavy satchel, asking after you by name. Find her out on the world map — she carries your first deck.",
    };
}
