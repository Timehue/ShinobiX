import type { BattleTab } from "../lib/use-battle-tabs";

/**
 * Segmented "Actions | Timeline" switch shared by Solo PvE and PvP combat.
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
                className={`battle-tab${tab === "actions" ? " battle-tab-active" : ""}`}
                onClick={() => setTab("actions")}
            >
                Actions
            </button>
            <button
                type="button"
                role="tab"
                aria-selected={tab === "log"}
                className={`battle-tab${tab === "log" ? " battle-tab-active" : ""}`}
                onClick={() => setTab("log")}
            >
                Timeline
                {unread > 0 && (
                    <span className="battle-tab-badge" aria-label={`${unread} new log entries`}>
                        {unread > 99 ? "99+" : unread}
                    </span>
                )}
            </button>
        </div>
    );
}
