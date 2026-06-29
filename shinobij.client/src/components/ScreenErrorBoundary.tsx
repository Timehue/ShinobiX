/**
 * Per-screen error boundary.
 *
 * The top-level ErrorBoundary (main.tsx) catches everything but, on a render
 * crash, replaces the WHOLE app with a reload card — so a bug in one screen
 * takes down the nav too. This boundary wraps just the active-screen region
 * (keyed by `screen` in App.tsx), so a crash degrades that ONE view to an inline
 * card while the side menu / mobile nav keep working — and because it's keyed by
 * screen, navigating away remounts it and clears the error automatically.
 *
 * Inline (not full-screen) fallback. A lazy-chunk error (stale deploy) is handled
 * by the top-level boundary's one-shot reload, so here it just shows the card.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../lib/sentry";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ScreenErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("[ScreenErrorBoundary]", error, info?.componentStack);
        reportError(error, { componentStack: info?.componentStack, scope: "screen" });
    }

    render(): ReactNode {
        if (!this.state.error) return this.props.children;
        return (
            <div role="alert" style={{ padding: "2rem 1.25rem", maxWidth: 520, margin: "1.5rem auto", textAlign: "center", background: "#0b1120", border: "1px solid rgba(250,204,21,0.35)", borderRadius: 14 }}>
                <div style={{ fontSize: 30, marginBottom: 8 }} aria-hidden>忍</div>
                <h2 style={{ fontSize: 18, color: "#facc15", margin: "0 0 6px" }}>This screen hit a snag</h2>
                <p style={{ fontSize: 14, lineHeight: 1.5, color: "#94a3b8", margin: "0 0 18px" }}>
                    Something went wrong drawing this view. Use the menu to go somewhere else, or reload — your progress is saved.
                </p>
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    style={{ cursor: "pointer", background: "linear-gradient(180deg, #facc15, #eab308)", color: "#1a1306", fontWeight: 700, fontSize: 14, border: "none", borderRadius: 10, padding: "10px 24px" }}
                >
                    Reload
                </button>
            </div>
        );
    }
}
