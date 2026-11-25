import type { NpcMarker } from "../lib/npc-quest-marker";
import "./npc-quest-marker.css";

/** The "!" or "?" over a quest giver's head. See lib/npc-quest-marker for what each colour means. */
export const NpcQuestMarker = ({ marker: { glyph, tier } }: { marker: NpcMarker }) =>
    <span className="npc-quest-marker" data-tier={tier} role="img" aria-label={tier + (glyph === "?" ? " quest to hand in" : " quest offered")}>{glyph}</span>;
