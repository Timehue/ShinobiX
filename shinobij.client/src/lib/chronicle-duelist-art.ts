/** Portrait resolution for the Chronicle duel board.
 *
 * A human duelist is shown their own uploaded avatar (`shared:img:avatar:<name>`).
 * The Chronicle Keeper is the house AI every PvE showdown is played against — it
 * has no player account and so no uploaded avatar, and used to fall back to the
 * "CK" initials tile. It gets bundled art instead, served from `public/chronicle/`
 * alongside the card back and the field environments.
 */
import { sharedAvatarFor } from "./shared-avatar";

/** Opponent name the server gives every AI showdown. Must match the literal in
 *  `api/card-clash/_ai-engine.ts` (`createAiMatch`). */
export const CHRONICLE_KEEPER_NAME = "Chronicle Keeper";

export const CHRONICLE_KEEPER_PORTRAIT = "/chronicle/keeper.webp";

export function isChronicleKeeper(name: string | undefined): boolean {
  return name?.trim().toLowerCase() === CHRONICLE_KEEPER_NAME.toLowerCase();
}

/** An uploaded avatar always wins, and only the Keeper gets the bundled
 *  fallback — a real PvP opponent who has not uploaded one still shows their
 *  initials rather than borrowing the Keeper's face. */
export function chronicleDuelistAvatar(
  name: string | undefined,
  sharedImages: Record<string, string> = {},
): string | undefined {
  // The Keeper has no account, so only its exact key counts: a slug match would
  // let a player who registers "ChronicleKeeper" put their face on the house AI.
  if (isChronicleKeeper(name)) return sharedImages[`avatar:${CHRONICLE_KEEPER_NAME.toLowerCase()}`] || CHRONICLE_KEEPER_PORTRAIT;
  return sharedAvatarFor(sharedImages, name) || undefined;
}
