/**
 * Top-level React error boundary.
 *
 * Without one, ANY render-time exception or a failed lazy-chunk import unmounts
 * the entire React tree to a blank white screen with no message — the most
 * likely "the game is broken" report at launch, since a stale index.html after
 * a deploy points at hashed chunk URLs that 404 until the page is reloaded.
 *
 * Behaviour:
 *   • Render error  → themed "Something went wrong" card with a Reload button.
 *   • Chunk-load error (stale deploy) → ONE automatic reload to pull the fresh
 *     index.html + hashed chunks, guarded by a sessionStorage flag so it can
 *     never loop. If the reload doesn't help, the card is shown.
 *
 * Styles are inline so the boundary still renders even if the CSS bundle itself
 * is the thing that failed to load.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../lib/sentry";

type Props = { children: ReactNode };
type State = { error: Error | null };

const RELOAD_FLAG = "__sj_chunk_reloaded";

function isChunkLoadError(err: Error): boolean {
    const msg = `${err?.name ?? ""} ${err?.message ?? ""}`;
    return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
        msg,
    );
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidMount(): void {
        // App mounted cleanly — clear the one-shot reload guard so a future
        // (genuinely new) stale-chunk error is allowed to auto-reload again.
        if (!this.state.error) {
            try {
                sessionStorage.removeItem(RELOAD_FLAG);
            } catch {
                /* sessionStorage unavailable (private mode / blocked) — ignore */
            }
        }
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("[ErrorBoundary]", error, info?.componentStack);
        if (isChunkLoadError(error)) {
            // Benign: a stale deploy left this tab pointing at 404'd chunk URLs.
            // Auto-reload once to pull the fresh build; do NOT report it — it's
            // expected churn, not a bug, and would only burn the event quota.
            try {
                if (!sessionStorage.getItem(RELOAD_FLAG)) {
                    sessionStorage.setItem(RELOAD_FLAG, "1");
                    window.location.reload();
                }
            } catch {
                /* fall through to the manual reload card */
            }
            return;
        }
        // Genuine render crash — report it so we hear about it from tooling, not
        // from players. No-op when Sentry is disabled (DSN unset).
        reportError(error, { componentStack: info?.componentStack });
    }

    private reload = (): void => {
        try {
            sessionStorage.removeItem(RELOAD_FLAG);
        } catch {
            /* ignore */
        }
        window.location.reload();
    };

    render(): ReactNode {
        if (!this.state.error) return this.props.children;
        const chunk = isChunkLoadError(this.state.error);
        return (
            <div
                role="alert"
                style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 2147483647,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "24px",
                    background:
                        "radial-gradient(ellipse at center, rgba(2,6,23,0.92), rgba(2,6,23,0.98))",
                    color: "#e2e8f0",
                    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                }}
            >
                <div
                    style={{
                        maxWidth: 440,
                        width: "100%",
                        textAlign: "center",
                        background: "#0b1120",
                        border: "1px solid rgba(250,204,21,0.35)",
                        borderRadius: 14,
                        padding: "28px 24px",
                        boxShadow: "0 18px 60px rgba(0,0,0,0.6)",
                    }}
                >
                    <div style={{ fontSize: 34, marginBottom: 10 }} aria-hidden>
                        忍
                    </div>
                    <h1 style={{ fontSize: 20, color: "#facc15", margin: "0 0 8px" }}>
                        {chunk ? "A new version is available" : "Something went wrong"}
                    </h1>
                    <p style={{ fontSize: 14, lineHeight: 1.5, color: "#94a3b8", margin: "0 0 20px" }}>
                        {chunk
                            ? "The game was updated while you were playing. Reload to get the latest version — your progress is saved."
                            : "An unexpected error interrupted the game. Reloading usually fixes it; your progress is saved."}
                    </p>
                    <button
                        type="button"
                        onClick={this.reload}
                        style={{
                            cursor: "pointer",
                            background: "linear-gradient(180deg, #facc15, #eab308)",
                            color: "#1a1306",
                            fontWeight: 700,
                            fontSize: 15,
                            border: "none",
                            borderRadius: 10,
                            padding: "11px 28px",
                        }}
                    >
                        Reload
                    </button>
                </div>
            </div>
        );
    }
}
