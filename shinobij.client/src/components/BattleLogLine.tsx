/*
 * One color-coded battle-log effect line. Classifies the line into a semantic
 * category (heal / damage / dmgmod / …) and emphasizes the numeric tokens so
 * players can read effects and values by color. Shared by the PvE arena and the
 * PvP battle screen so both logs color identically. See lib/battle-log-format.
 */
import { memo } from "react";
import { classifyBattleLogLine, tokenizeBattleLogLine } from "../lib/battle-log-format";
import { GameArtIcon, type GameArtIconKind } from "./GameArtIcon";

const CATEGORY_ART: Record<string, GameArtIconKind> = {
    heal: "vitality",
    damage: "attack",
    dmgmod: "elementLightning",
    shield: "guard",
    control: "gate",
    prevent: "warning",
    tempo: "speed",
    system: "scroll",
    effect: "event",
};

// Memoized: log lines are append-only, so with identical (line, prefix) props an
// existing line skips re-classify/re-tokenize/re-render on every combat action.
// Over a long fight this keeps the log from getting heavier to re-render each
// turn — part of cutting the per-action hitch (e.g. the freeze when casting).
//
// Each line leads with a small painted category mark (heal/damage/shield/…)
// so players can scan the event type before reading the words. Pass an explicit
// prefix only for the rare call site that needs a textual marker.
export const BattleLogLine = memo(function BattleLogLine({ line, prefix }: { line: string; prefix?: string }) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const category = classifyBattleLogLine(trimmed);
    const segments = tokenizeBattleLogLine(trimmed);
    return (
        <p className={`timeline-fx battle-log-line battle-log-${category}`}>
            <span className="bl-glyph" aria-hidden="true">
                {prefix ?? <GameArtIcon kind={CATEGORY_ART[category]} size={15} />}
            </span>
            {segments.map((seg, i) =>
                seg.isNumber
                    ? <span className="bl-num" key={i}>{seg.text}</span>
                    : <span key={i}>{seg.text}</span>,
            )}
        </p>
    );
});
