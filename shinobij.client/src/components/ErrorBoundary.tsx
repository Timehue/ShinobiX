import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("[ErrorBoundary]", error, info.componentStack);
        // Report to Sentry if it's been initialized. Dynamic require so this
        // file has no hard dependency on @sentry/react.
        try {
            const sentry = (window as unknown as { Sentry?: { captureException?: (e: unknown) => void } }).Sentry;
            sentry?.captureException?.(error);
        } catch { /* ignore */ }
    }

    handleReload = () => {
        window.location.reload();
    };

    handleResetSave = () => {
        if (!window.confirm("Clear local save data and reload? This may help if the game won't start, but you'll lose any unsaved progress.")) return;
        try {
            // Wipe only known save keys so we don't nuke unrelated localStorage entries.
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key && (key.startsWith("shinobi") || key.startsWith("pvp:") || key.startsWith("pendingPet") || key === "character" || key === "currentAccountName")) {
                    localStorage.removeItem(key);
                }
            }
            sessionStorage.clear();
        } catch { /* ignore */ }
        window.location.reload();
    };

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "2rem",
                background: "rgba(2, 6, 23, 0.95)",
                color: "#e2e8f0",
                fontFamily: "system-ui, sans-serif",
            }}>
                <div style={{
                    maxWidth: 480,
                    width: "100%",
                    padding: "2rem",
                    border: "1px solid rgba(248, 113, 113, 0.4)",
                    borderRadius: 12,
                    background: "rgba(15, 23, 42, 0.85)",
                    textAlign: "center",
                }}>
                    <h2 style={{ marginTop: 0, color: "#fca5a5" }}>Something broke.</h2>
                    <p style={{ opacity: 0.8 }}>The game hit an unexpected error and stopped rendering. Try reloading first. If it keeps happening, clearing local save data may unstick it.</p>
                    {this.state.error?.message && (
                        <pre style={{
                            background: "rgba(0,0,0,0.4)",
                            padding: "0.75rem",
                            borderRadius: 6,
                            fontSize: 12,
                            textAlign: "left",
                            overflow: "auto",
                            maxHeight: 160,
                        }}>{this.state.error.message}</pre>
                    )}
                    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "1rem", flexWrap: "wrap" }}>
                        <button onClick={this.handleReload} style={{
                            padding: "0.6rem 1.2rem",
                            background: "#38bdf8",
                            color: "#0f172a",
                            border: 0,
                            borderRadius: 6,
                            fontWeight: 600,
                            cursor: "pointer",
                        }}>Reload</button>
                        <button onClick={this.handleResetSave} style={{
                            padding: "0.6rem 1.2rem",
                            background: "transparent",
                            color: "#fca5a5",
                            border: "1px solid rgba(248, 113, 113, 0.5)",
                            borderRadius: 6,
                            cursor: "pointer",
                        }}>Clear save & reload</button>
                    </div>
                </div>
            </div>
        );
    }
}
