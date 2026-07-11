import { useState } from "react";
import { releaseNoticeForScreen, type LaunchState } from "../lib/release-readiness";
import type { Screen } from "../types/core";

const STATE_LABEL: Record<LaunchState, string> = {
    ready: "Ready",
    monitor: "Monitor",
    gate: "Gated",
    desktop: "Desktop-first",
};

const STATE_COLOR: Record<LaunchState, string> = {
    ready: "var(--green-400)",
    monitor: "var(--cyan)",
    gate: "var(--gold)",
    desktop: "var(--purple-400)",
};

function readDismissed(id: string): boolean {
    try {
        return localStorage.getItem(`releaseNoticeDismissed:${id}`) === "1";
    } catch {
        return false;
    }
}

function writeDismissed(id: string) {
    try {
        localStorage.setItem(`releaseNoticeDismissed:${id}`, "1");
    } catch {
        // Private browsing or disabled storage: dismissal still works in state.
    }
}

export function ReleaseReadinessNotice({ screen }: { screen: Screen }) {
    const notice = releaseNoticeForScreen(screen);
    const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
    const dismissed = notice ? dismissedIds.has(notice.id) || readDismissed(notice.id) : false;
    if (!notice || dismissed) return null;

    const accent = STATE_COLOR[notice.state];
    const dismiss = () => {
        writeDismissed(notice.id);
        setDismissedIds((prev) => new Set(prev).add(notice.id));
    };

    return (
        <aside
            role="note"
            aria-label={`${STATE_LABEL[notice.state]} public beta notice`}
            style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                margin: "0 auto 12px",
                maxWidth: 1120,
                width: "min(100%, calc(100vw - 24px))",
                padding: "10px 12px",
                border: `1px solid ${accent}66`,
                borderRadius: 8,
                background: "linear-gradient(90deg, rgba(15,23,42,.96), rgba(30,41,59,.88))",
                boxShadow: "0 8px 22px rgba(0,0,0,.26)",
                color: "#e5e7eb",
                fontSize: 13,
                lineHeight: 1.35,
            }}
        >
            <span
                style={{
                    flex: "0 0 auto",
                    color: accent,
                    border: `1px solid ${accent}66`,
                    borderRadius: 999,
                    padding: "2px 8px",
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: 0.2,
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                }}
            >
                {STATE_LABEL[notice.state]}
            </span>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <strong style={{ display: "block", color: "#f8fafc", marginBottom: 2 }}>{notice.title}</strong>
                <span style={{ color: "var(--slate-300)" }}>{notice.body}</span>
            </div>
            <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss public beta notice"
                title="Dismiss notice"
                style={{
                    flex: "0 0 auto",
                    minWidth: 34,
                    minHeight: 34,
                    border: "1px solid rgba(148,163,184,.35)",
                    borderRadius: 8,
                    background: "rgba(15,23,42,.8)",
                    color: "var(--slate-300)",
                    cursor: "pointer",
                    fontWeight: 800,
                }}
            >
                x
            </button>
        </aside>
    );
}
