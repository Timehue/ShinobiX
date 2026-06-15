/*
 * Unread-mail indicators for the nav menus.
 *
 *   • MailUnreadBadge — a small count bubble for the "Mail" buttons (desktop
 *     right-rail + mobile menu grid). Renders nothing when there's no unread.
 *   • MailUnreadDot   — a bare presence dot for the mobile bottom-bar "Menu"
 *     button, since Mail lives inside that menu and would otherwise be
 *     invisible at a glance.
 *
 * Both subscribe to the shared single-poller store in lib/mail-unread, so
 * mounting them in multiple places does not multiply network polling.
 */
import { useEffect, useState } from "react";
import { getUnreadMail, subscribeUnreadMail } from "../lib/mail-unread";

export function MailUnreadBadge() {
    const [n, setN] = useState(getUnreadMail());
    useEffect(() => subscribeUnreadMail(setN), []);
    if (n <= 0) return null;
    return (
        <span className="mail-unread-badge" aria-label={`${n} unread message${n === 1 ? "" : "s"}`}>
            {n > 9 ? "9+" : n}
        </span>
    );
}

export function MailUnreadDot() {
    const [n, setN] = useState(getUnreadMail());
    useEffect(() => subscribeUnreadMail(setN), []);
    if (n <= 0) return null;
    return <span className="mobile-nav-unread-dot" aria-label="Unread mail" />;
}
