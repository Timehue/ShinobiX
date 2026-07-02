import type { BattleTab } from "../lib/use-battle-tabs";

/**
 * Segmented "Actions | Battle Log" switch for the mobile battle UI, used by both
 * the PvE (Arena) and PvP battle screens. Hidden on desktop via CSS, where the
 * action bar and log render together. The unread badge mirrors the
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
