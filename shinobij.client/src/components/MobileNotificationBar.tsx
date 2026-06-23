/*
 * Mobile status notification bar — a horizontal strip that floats just above
 * the bottom nav (the mobile equivalent of the "Menu" button). Mirrors the
 * desktop NotificationBar: same chips, same data (shared useNotifications hook),
 * clickable through to the relevant screen.
 *
 * Renders nothing when there are no notifications, so it never occupies space
 * unless there's something to show. Rendered by MobileNav while its full-screen
 * menu overlay is closed.
 */
import type { Screen } from "../types/core";
import { useNotifications } from "../lib/use-notifications";

export function MobileNotificationBar({
    navigate,
    screen,
    clan,
    village,
}: {
    navigate: (screen: Screen) => void;
    screen: Screen;
    clan: string;
    village: string;
}) {
    const notes = useNotifications(screen, clan, village);

    if (notes.length === 0) return null;

    return (
        <div className="mobile-notif-bar" role="status" aria-live="polite">
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
                    <span className="notif-chip-label">{n.label}</span>
                </button>
            ))}
        </div>
    );
}
