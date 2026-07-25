import { tributeCountForLevel } from "./chronicle-duel";
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
    if (state.normalSummonUsed) return none;
    const needsTributes = tributeCountForLevel(selected.level) > 0;
    const monsterZones: number[] = [];
    const tributeZones: number[] = [];
    me.monsterZones.forEach((monster, index) => {
      if (!monster) monsterZones.push(index);
      else if (needsTributes) tributeZones.push(index);
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
