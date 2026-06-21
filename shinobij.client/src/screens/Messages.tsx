/*
 * Direct messages (mail) — inbox + conversation + compose.
 *
 * Polling-based (every 8s) against /api/messages. Auth headers are attached
 * globally by the window.fetch interceptor (authFetch.ts), so plain fetch() is
 * fine here. Single-pane (inbox OR conversation) so it works on mobile.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { visiblePoll } from "../lib/poll";
import type { Character } from "../types/character";
import { refreshUnreadMail } from "../lib/mail-unread";

type DmMessage = { from: string; text: string; ts: number };
type InboxEntry = { with: string; lastTs: number; lastText: string; unread: number };

function timeAgo(ts: number): string {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

export const Messages = memo(function Messages({ character, onBack, initialWith }: {
    character: Character;
    onBack: () => void;
    initialWith?: string | null;
}) {
    const me = character.name.toLowerCase();
    const [inbox, setInbox] = useState<InboxEntry[]>([]);
    const [active, setActive] = useState<string | null>(initialWith ? initialWith.toLowerCase() : null);
    const [thread, setThread] = useState<DmMessage[]>([]);
    const [draft, setDraft] = useState("");
    const [composeTo, setComposeTo] = useState(initialWith ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const threadRef = useRef<HTMLDivElement>(null);

    const loadInbox = useCallback(async () => {
        try { const r = await fetch("/api/messages"); if (r.ok) { const j = await r.json(); setInbox(Array.isArray(j) ? j : []); } } catch { /* offline */ }
    }, []);
    const loadThread = useCallback(async (withName: string) => {
        try {
            const r = await fetch(`/api/messages?with=${encodeURIComponent(withName)}`);
            if (r.ok) {
                const j = await r.json();
                setThread(Array.isArray(j) ? j : []);
                // Opening a conversation marks it read server-side — nudge the
                // shared unread store so the nav badge clears without waiting a
                // full poll interval.
                refreshUnreadMail();
            }
        } catch { /* offline */ }
    }, []);

    useEffect(() => { void loadInbox(); }, [loadInbox]);
    useEffect(() => { if (active) void loadThread(active); }, [active, loadThread]);
    // Poll inbox + the open thread while the screen is mounted.
    useEffect(() => {
        return visiblePoll(() => { void loadInbox(); if (active) void loadThread(active); }, 8000);
    }, [active, loadInbox, loadThread]);
    useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [thread]);

    const send = useCallback(async (to: string, text: string) => {
        const target = to.trim();
        const body = text.trim();
        if (!target || !body || busy) return;
        setBusy(true); setError("");
        try {
            const r = await fetch("/api/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to: target, text: body }),
            });
            if (r.ok) {
                setThread(await r.json());
                setDraft("");
                setActive(target.toLowerCase());
                void loadInbox();
            } else {
                const e = await r.json().catch(() => ({}));
                setError(typeof e.error === "string" ? e.error : "Could not send message.");
            }
        } catch {
            setError("Network error — please retry.");
        } finally {
            setBusy(false);
        }
    }, [busy, loadInbox]);

    return (
        <div className="card" style={{ maxWidth: 720, margin: "0 auto" }}>
            <div className="menu" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>📬 Messages</h2>
                <button onClick={onBack}>← Back</button>
            </div>

            {active ? (
                <div className="summary-box" style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong style={{ color: "#fbbf24" }}>{active}</strong>
                        <button onClick={() => { setActive(null); setError(""); void loadInbox(); }}>← Inbox</button>
                    </div>
                    <div ref={threadRef} style={{ maxHeight: "50vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, padding: "4px 0" }}>
                        {thread.length === 0 ? (
                            <p className="hint">No messages yet — say hello.</p>
                        ) : thread.map((m, i) => {
                            const mine = m.from.toLowerCase() === me;
                            return (
                                <div key={i} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "78%", background: mine ? "#1e3a8a" : "#1f2937", border: `1px solid ${mine ? "#3b82f6" : "#374151"}`, borderRadius: 10, padding: "6px 10px" }}>
                                    <div style={{ fontSize: 13, color: "#e5e7eb", wordBreak: "break-word" }}>{m.text}</div>
                                    <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2, textAlign: "right" }}>{timeAgo(m.ts)}</div>
                                </div>
                            );
                        })}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(active, draft); }} placeholder={`Message ${active}…`} maxLength={500} style={{ flex: 1 }} />
                        <button disabled={busy || !draft.trim()} onClick={() => void send(active, draft)}>Send</button>
                    </div>
                    {error && <p className="hint" style={{ color: "#f87171", marginTop: 6 }}>{error}</p>}
                </div>
            ) : (
                <>
                    <div className="summary-box" style={{ marginBottom: 10 }}>
                        <strong>New message</strong>
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                            <input value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="Recipient name" style={{ width: 160 }} />
                            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(composeTo, draft); }} placeholder="Message…" maxLength={500} style={{ flex: 1, minWidth: 160 }} />
                            <button disabled={busy || !composeTo.trim() || !draft.trim()} onClick={() => void send(composeTo, draft)}>Send</button>
                        </div>
                        {error && <p className="hint" style={{ color: "#f87171", marginTop: 6 }}>{error}</p>}
                    </div>
                    <div className="summary-box">
                        <strong>Inbox</strong>
                        {inbox.length === 0 ? (
                            <p className="hint">No conversations yet.</p>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                                {inbox.map((e) => (
                                    <button key={e.with} onClick={() => { setActive(e.with); setError(""); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", padding: "6px 10px", background: e.unread > 0 ? "#1e293b" : "transparent", border: "1px solid #334155", borderRadius: 8 }}>
                                        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                            <strong style={{ color: "#e5e7eb" }}>{e.with}{e.unread > 0 ? ` (${e.unread})` : ""}</strong>
                                            <small style={{ color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>{e.lastText}</small>
                                        </span>
                                        <small style={{ color: "#64748b", flexShrink: 0, marginLeft: 8 }}>{timeAgo(e.lastTs)}</small>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
});
