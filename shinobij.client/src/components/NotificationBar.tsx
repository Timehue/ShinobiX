/*
 * Right-rail status notification bar — sits above the "Hide Menu" button in the
 * desktop RightMenu. Surfaces ongoing things the player should know about (an
 * active fight, a clan/village war, a live tournament) as colour-coded chips
 * that click through to the relevant screen.
 *
 * Data comes from the shared useNotifications hook (re-derived from the
 * already-polled caches, no new network). `compact` (collapsed 74px rail)
 * renders icon-only chips. The mobile equivalent is components/MobileNotificationBar.
 */
import type { Screen } from "../types/core";
import { useNotifications } from "../lib/use-notifications";

export function NotificationBar({
    navigate,
    screen,
    clan,
    village,
    compact = false,
}: {
    navigate: (screen: Screen) => void;
    screen: Screen;
    clan: string;
    village: string;
    compact?: boolean;
}) {
    const notes = useNotifications(screen, clan, village);

    if (notes.length === 0) return null;

    return (
        <div className={`notif-bar${compact ? " compact" : ""}`} role="status" aria-live="polite">
            {!compact && <div className="notif-bar-title">Notifications</div>}
            <div className="notif-bar-list">
                {notes.map((n) => (
                    <button
                        key={n.id}
                        type="button"
                        className={`notif-chip tone-${n.tone}${n.screen ? "" : " static"}`}
                        title={n.screen ? `Go to ${n.label}` : n.label}
                        aria-label={n.label}
                        onClick={n.screen ? () => navigate(n.screen!) : undefined}
                    >
                        <span className="notif-chip-icon" aria-hidden="true">{n.icon}</span>
                        {!compact && <span className="notif-chip-label">{n.label}</span>}
                    </button>
                ))}
            </div>
        </div>
    );
}
