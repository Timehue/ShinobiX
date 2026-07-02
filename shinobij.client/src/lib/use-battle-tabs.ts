import { useState } from "react";

export type BattleTab = "actions" | "log";

/**
 * Mobile battle UI splits the action bar + jutsu/item grid ("actions") from the
 * battle log ("log") into two tabs so neither has to share the short mobile
 * viewport (the board — HUDs + AP + battlefield — stays visible above both).
 * Desktop shows everything and hides the tab bar via CSS.
 *
 * Tracks an unread count so the log tab can badge new entries the player hasn't
 * seen. Pass the current number of log entries (Arena: battleHistory.length,
 * PvP: session.log.length).
 */
export function useBattleTabs(logLength: number): {
    tab: BattleTab;
    setTab: (t: BattleTab) => void;
    unread: number;
} {
    const [tab, setTabState] = useState<BattleTab>("actions");
    // "Seen" high-water mark, seeded to whatever the log already holds so a
    // restored mid-fight battle doesn't badge its backlog. Advanced only in the
    // event handler below (no effect / no ref-in-render), which keeps the lint
    // rules happy and the render pure.
    const [seen, setSeen] = useState(logLength);
    const setTab = (t: BattleTab) => {
        // Leaving the log marks everything it currently holds as read; while the
        // log is the active tab unread is forced to 0 regardless.
        if (tab === "log" && t !== "log") setSeen(logLength);
        setTabState(t);
    };
    const unread = tab === "log" ? 0 : Math.max(0, logLength - seen);
    return { tab, setTab, unread };
}
