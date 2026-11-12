import { callOnlySummonBlocker, tributeCountForLevel } from "./chronicle-duel";
import type {
  ChronicleDisplayCard,
  ChronicleProjection,
} from "./chronicle-duel";

export interface ChroniclePlacements {
  /** Which kind of placement the picked card starts. `none` means the
   *  selection places nothing into a zone — a Jutsu activates straight from
   *  hand, or the turn's one Normal Summon is already spent. */
  mode: "monster" | "trap" | "none";
  /** Open Monster Zones the picked Monster can be summoned or set into. */
  monsterZones: number[];
  /** Own Monsters that can be offered, when the picked Level demands Tributes. */
  tributeZones: number[];
  /** Open Jutsu/Snare Zones the picked Snare can be set into. */
  trapZones: number[];
}

/** The Tributes a card starts with when it is picked up. When exactly as many
 *  Monsters can be offered as its Level demands there is nothing to choose, so
 *  they are offered up front and the player goes straight to playing it. */
export function chronicleAutoTributes(
  placements: ChroniclePlacements,
  required: number,
): number[] {
  return required > 0 && placements.tributeZones.length === required
    ? placements.tributeZones.slice()
    : [];
}

/** The Monster Zone a Summon lands in. A zone the player picked wins while it
 *  is still legal: open, or being vacated by an offered Tribute. Otherwise a
 *  complete Tribute hands over its first zone, so the new Monster takes the
 *  place of the one it replaced with no separate placement step. */
export function chronicleSummonZone(
  placements: ChroniclePlacements,
  tributes: readonly number[],
  required: number,
  chosen: number | null,
): number | null {
  if (placements.mode !== "monster") return null;
  if (
    chosen !== null &&
    (placements.monsterZones.includes(chosen) || tributes.includes(chosen))
  )
    return chosen;
  return required > 0 && tributes.length === required ? tributes[0] : null;
}

/** Every zone the card picked up from hand can legally enter, mirroring the
 *  server's own summon/set validation. The duel board glows exactly these
 *  zones, so a lit zone is never a move the server will turn away. */
export function chronicleLegalPlacements(
  state: ChronicleProjection,
  selected: ChronicleDisplayCard | undefined,
): ChroniclePlacements {
  const none: ChroniclePlacements = {
    mode: "none",
    monsterZones: [],
    tributeZones: [],
    trapZones: [],
  };
  const me = state[state.viewerSide];
  const myTurn =
    state.activePlayer === state.viewerSide &&
    !state.responseWindow &&
    state.status === "active";
  const main = state.phase === "main1" || state.phase === "main2";
  if (!myTurn || !main || !selected) return none;
  if (selected.cardClass === "monster") {
    // A called Monster enters only through its Call, never from here.
    if (state.normalSummonUsed || callOnlySummonBlocker(selected)) return none;
    const needsTributes = tributeCountForLevel(selected.level) > 0;
    const monsterZones: number[] = [];
    const tributeZones: number[] = [];
    me.monsterZones.forEach((monster, index) => {
      if (!monster) monsterZones.push(index);
      // A Shadow Double cannot pay a Tribute on the turn it appears.
      else if (needsTributes && monster.canTribute !== false) tributeZones.push(index);
    });
    return { mode: "monster", monsterZones, tributeZones, trapZones: [] };
  }
  if (selected.cardClass === "trap")
    return {
      mode: "trap",
      monsterZones: [],
      tributeZones: [],
      trapZones: me.magicTrapZones.flatMap((zone, index) =>
        zone ? [] : [index],
      ),
    };
  return none;
}
