import type { NpcMarker } from "../lib/npc-quest-marker";
import "./npc-quest-marker.css";

/** The "!" or "?" over a quest giver's head. See lib/npc-quest-marker for what each colour means. */
export function NpcQuestMarker({ marker }: { marker: NpcMarker }) {
    return <span className="npc-quest-marker" data-tier={marker.tier} data-glyph={marker.glyph} role="img" aria-label={marker.label}>{marker.glyph}</span>;
}
