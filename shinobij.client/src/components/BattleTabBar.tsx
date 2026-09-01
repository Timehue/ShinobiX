import type { BattleTab } from "../lib/use-battle-tabs";
import { handleHorizontalTabKeyDown } from "../lib/tab-keyboard";

/**
 * Segmented "Actions | Battle Log" switch shared by Solo PvE and PvP combat.
 * The unread badge mirrors the
 * notification-style count of new log entries since the log was last viewed.
 */
export function BattleTabBar({
    tab,
    setTab,
    unread,
}: {
    tab: BattleTab;
    setTab: (t: BattleTab) => void;
    unread: number;
}) {
    return (
        <div className="battle-tabbar" role="tablist" aria-label="Battle panels">
            <button
                type="button"
                role="tab"
                aria-selected={tab === "actions"}
                tabIndex={tab === "actions" ? 0 : -1}
                className={`battle-tab${tab === "actions" ? " battle-tab-active" : ""}`}
                onKeyDown={handleHorizontalTabKeyDown}
                onClick={() => setTab("actions")}
            >
                Actions
            </button>
            <button
                type="button"
                role="tab"
                aria-selected={tab === "log"}
                tabIndex={tab === "log" ? 0 : -1}
                className={`battle-tab${tab === "log" ? " battle-tab-active" : ""}`}
                onKeyDown={handleHorizontalTabKeyDown}
                onClick={() => setTab("log")}
            >
                Battle Log
                {unread > 0 && (
                    <span className="battle-tab-badge" aria-label={`${unread} new log entries`}>
                        {unread > 99 ? "99+" : unread}
                    </span>
                )}
            </button>
        </div>
    );
}
