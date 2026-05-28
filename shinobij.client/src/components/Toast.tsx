/**
 * Non-blocking toast notifications.
 *
 * Distinct from GameAlert (which is a blocking modal). Toasts are brief,
 * auto-dismissed, and stacked at the bottom-right. Designed for "save failed"
 * style notices that shouldn't interrupt gameplay but the player should still
 * see.
 *
 * Usage from anywhere (after <ToastHost /> mounts):
 *     import { showToast } from "./components/Toast";
 *     showToast("Save failed — retrying…");
 */
import { useEffect, useState } from "react";

type Toast = { id: number; message: string; kind: "error" | "info" };
type Listener = (toast: Toast) => void;

let nextId = 1;
let activeListener: Listener | null = null;
let pendingToasts: Toast[] = [];
let lastShownAt = new Map<string, number>();

const DUPE_SUPPRESS_MS = 5_000;

export function showToast(message: string, kind: Toast["kind"] = "error") {
    // Throttle identical messages — a save loop that fails 10x/sec shouldn't
    // produce 10 stacked toasts.
    const now = Date.now();
    const last = lastShownAt.get(message) ?? 0;
    if (now - last < DUPE_SUPPRESS_MS) return;
    lastShownAt.set(message, now);

    const toast: Toast = { id: nextId++, message, kind };
    if (activeListener) activeListener(toast);
    else pendingToasts.push(toast);
}

export function ToastHost() {
    const [toasts, setToasts] = useState<Toast[]>([]);

    useEffect(() => {
        activeListener = (t: Toast) => {
            setToasts((prev) => [...prev, t]);
            window.setTimeout(() => {
                setToasts((prev) => prev.filter((x) => x.id !== t.id));
            }, 4500);
        };
        if (pendingToasts.length > 0) {
            const drained = pendingToasts;
            pendingToasts = [];
            drained.forEach((t) => activeListener?.(t));
        }
        return () => { activeListener = null; };
    }, []);

    if (toasts.length === 0) return null;
    return (
        <div style={{
            position: "fixed",
            bottom: "1rem",
            right: "1rem",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            maxWidth: "90vw",
            pointerEvents: "none",
        }}>
            {toasts.map((t) => (
                <div key={t.id} style={{
                    padding: "0.7rem 1rem",
                    borderRadius: 8,
                    background: t.kind === "error" ? "rgba(127, 29, 29, 0.95)" : "rgba(15, 23, 42, 0.95)",
                    color: "#fef2f2",
                    border: t.kind === "error" ? "1px solid rgba(248, 113, 113, 0.55)" : "1px solid rgba(56, 189, 248, 0.4)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                    fontSize: 14,
                    fontFamily: "system-ui, sans-serif",
                    pointerEvents: "auto",
                    maxWidth: 360,
                }}>{t.message}</div>
            ))}
        </div>
    );
}
