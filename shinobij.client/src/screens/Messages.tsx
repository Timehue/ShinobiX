/*
 * Direct messages (mail) — inbox + conversation + compose.
 *
 * Polling-based (every 8s) against /api/messages. Auth headers are attached
 * globally by the window.fetch interceptor (authFetch.ts), so plain fetch() is
 * fine here. Single-pane (inbox OR conversation) so it works on mobile.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { visiblePoll } from "../lib/poll";
import { EmptyState } from "../components/ui/EmptyState";
import { GiChatBubble } from "../components/icons/LightweightGameIcons";
import courierHero from "../assets/facilities/messages-courier-hero.webp";
import { ReportControl } from "../components/ReportControl";
import type { Character } from "../types/character";
import { refreshUnreadMail } from "../lib/mail-unread";
import { GuestSocialLock } from "../components/GuestSocialLock";
import { useSocialLock } from "../lib/account-status";

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
    const [blocked, setBlocked] = useState<Set<string>>(() => new Set());
    // Guests can still READ the mail they were sent — only sending is shut, so
    // the inbox and threads stay intact and only the composers go away.
    const { locked: sendLocked, loading: lockLoading } = useSocialLock(character.name);
    const composeDisabled = sendLocked || lockLoading;
    const threadRef = useRef<HTMLDivElement>(null);

    const loadInbox = useCallback(async () => {
        try { const r = await fetch("/api/messages"); if (r.ok) { const j = await r.json(); setInbox(Array.isArray(j) ? j : []); } } catch { /* offline */ }
    }, []);
    const loadBlocks = useCallback(async () => {
        try {
            const r = await fetch("/api/player/blocks");
            if (!r.ok) return;
            const j = await r.json() as { blocked?: unknown };
            setBlocked(new Set(Array.isArray(j.blocked) ? j.blocked.map(String) : []));
        } catch { /* offline */ }
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

    useEffect(() => { void loadInbox(); void loadBlocks(); }, [loadBlocks, loadInbox]);
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

    const setPlayerBlocked = useCallback(async (target: string, value: boolean) => {
        if (busy) return;
        setBusy(true); setError("");
        try {
            const r = await fetch("/api/player/blocks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ target, blocked: value }),
            });
            const data = await r.json().catch(() => ({})) as { error?: string; blocked?: unknown };
            if (!r.ok) throw new Error(data.error || "Could not update this player.");
            setBlocked(new Set(Array.isArray(data.blocked) ? data.blocked.map(String) : []));
            void loadInbox();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not update this player.");
        } finally {
            setBusy(false);
        }
    }, [busy, loadInbox]);

    return (
        <div className="card" style={{ maxWidth: 720, margin: "0 auto", padding: 0, overflow: "hidden" }}>
            <div style={{ position: "relative" }}>
                <img src={courierHero} alt="" style={{ display: "block", width: "100%", height: 170, objectFit: "cover", objectPosition: "center 32%" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,11,15,.05) 25%, rgba(8,11,15,.94))" }} />
                <button onClick={onBack} style={{ position: "absolute", top: 10, right: 10 }}>← Back</button>
                <div style={{ position: "absolute", left: 18, right: 18, bottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--sj-gold)" }}>Village Post · Courier Desk</div>
                    <h2 style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 400, letterSpacing: ".02em" }}>Messages</h2>
                </div>
            </div>
            <div style={{ padding: "12px 14px 14px" }}>

            {active ? (
                <div className="summary-box" style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <strong style={{ color: "#fbbf24" }}>{active}</strong>
                            <ReportControl targetType="player" targetName={active} context="direct-message" />
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void setPlayerBlocked(active, !blocked.has(active))}
                                style={{ fontSize: 11, padding: "2px 7px", color: blocked.has(active) ? "#86efac" : "#fca5a5" }}
                            >
                                {blocked.has(active) ? "Unblock" : "Block"}
                            </button>
                        </span>
                        <button onClick={() => { setActive(null); setError(""); void loadInbox(); }}>← Inbox</button>
                    </div>
                    <div ref={threadRef} style={{ maxHeight: "50vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, padding: "4px 0" }}>
                        {thread.length === 0 ? (
                            <EmptyState icon={<GiChatBubble size={28} style={{ color: "var(--sj-text-muted)" }} />}>No messages yet — say hello.</EmptyState>
                        ) : thread.map((m, i) => {
                            const mine = m.from.toLowerCase() === me;
                            return (
                                <div key={i} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "78%", background: mine ? "rgba(116, 173, 189, 0.16)" : "var(--sj-surface-high)", border: `1px solid ${mine ? "rgba(116, 173, 189, 0.45)" : "var(--sj-border-soft)"}`, borderRadius: 10, padding: "6px 10px" }}>
                                    <div style={{ fontSize: 13, color: "#e5e7eb", wordBreak: "break-word" }}>{m.text}</div>
                                    <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 2, textAlign: "right" }}>{timeAgo(m.ts)}</div>
                                </div>
                            );
                        })}
                    </div>
                    {sendLocked ? (
                        <GuestSocialLock compact what="Guest characters can read the mail they are sent, but cannot reply." />
                    ) : (
                        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                            <input disabled={blocked.has(active) || composeDisabled} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(active, draft); }} placeholder={blocked.has(active) ? `${active} is blocked` : `Message ${active}…`} maxLength={500} style={{ flex: 1 }} />
                            <button disabled={busy || blocked.has(active) || composeDisabled || !draft.trim()} onClick={() => void send(active, draft)}>Send</button>
                        </div>
                    )}
                    {error && <p className="hint" style={{ color: "var(--red-400)", marginTop: 6 }}>{error}</p>}
                </div>
            ) : (
                <>
                    <div className="summary-box" style={{ marginBottom: 10 }}>
                        <strong>New message</strong>
                        {sendLocked ? (
                            <GuestSocialLock compact what="Guest characters cannot start a conversation." />
                        ) : (
                            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                                <input value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="Recipient name" style={{ width: 160 }} />
                                <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(composeTo, draft); }} placeholder="Message…" maxLength={500} style={{ flex: "1 1 200px", minWidth: 0 }} />
                                <button disabled={busy || composeDisabled || !composeTo.trim() || !draft.trim()} onClick={() => void send(composeTo, draft)}>Send</button>
                            </div>
                        )}
                        {error && <p className="hint" style={{ color: "var(--red-400)", marginTop: 6 }}>{error}</p>}
                    </div>
                    <div className="summary-box">
                        <strong>Inbox</strong>
                        {inbox.length === 0 ? (
                            <EmptyState icon={<GiChatBubble size={30} style={{ color: "var(--sj-text-muted)" }} />}>No conversations yet.</EmptyState>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                                {inbox.map((e) => (
                                    <button key={e.with} onClick={() => { setActive(e.with); setError(""); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", padding: "6px 10px", background: e.unread > 0 ? "var(--slate-800)" : "transparent", border: "1px solid var(--slate-700)", borderRadius: 8 }}>
                                        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                            <strong style={{ color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{e.with}{e.unread > 0 ? ` (${e.unread})` : ""}</strong>
                                            <small style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>{e.lastText}</small>
                                        </span>
                                        <small style={{ color: "var(--text-muted)", flexShrink: 0, marginLeft: 8 }}>{timeAgo(e.lastTs)}</small>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
            </div>
        </div>
    );
});
