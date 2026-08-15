import { liveServiceNotice } from "../lib/live-service-notice";
import { useLiveCapabilities } from "../lib/live-capabilities-context";
import type { Screen } from "../types/core";

export function LiveServiceNotice({ screen }: { screen: Screen }) {
    const { snapshot: { capabilities } } = useLiveCapabilities();
    const notice = capabilities ? liveServiceNotice(screen, capabilities) : null;
    if (!notice) return null;
    return (
        <aside role="status" aria-live="polite" aria-label="Live service status" style={{ margin: "0 auto 12px", maxWidth: 1120, width: "min(100%, calc(100vw - 24px))", padding: "10px 12px", border: "1px solid rgba(248,113,113,.55)", borderRadius: 8, background: "rgba(69,10,10,.92)", color: "#fee2e2", fontSize: 13 }}>
            <strong style={{ display: "block", marginBottom: 2 }}>{notice.title}</strong>
            <span>{notice.body}</span>
        </aside>
    );
}
