import { useId, useState, type ReactNode, type SyntheticEvent } from 'react';

const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

/** Optional map notices keep their action available without covering the playfield. */
export function MapNotificationBanner({ identity, label, className, children }: {
    identity: string; label: string; className: string; children: ReactNode;
}) {
    const contentId = useId();
    const [state, setState] = useState({ identity, collapsed: false });
    // A new lesson or sector must announce itself even if the previous notice was tucked away.
    // Keep the action mounted so a dialog can restore focus to its original opener.
    if (state.identity !== identity) setState({ identity, collapsed: false });
    const collapsed = state.identity === identity && state.collapsed;
    return <div className={`${className} map-notification-banner${collapsed ? ' is-collapsed' : ''}`}
        data-sector-hud="true" onPointerDown={stopPropagation} onClick={stopPropagation}>
        <div id={contentId} className="map-notice-content" hidden={collapsed}>{children}</div>
        <button type="button" className="map-notice-toggle" aria-controls={contentId} aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
            onClick={event => {
                setState({ identity, collapsed: !collapsed });
                event.currentTarget.focus({ preventScroll: true });
            }}><span aria-hidden="true">{collapsed ? '+' : '−'}</span></button>
    </div>;
}
