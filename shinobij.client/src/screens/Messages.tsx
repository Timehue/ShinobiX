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
import { LoadingState } from "../components/ui/LoadingState";
import { GiChatBubble, GiTrashCan } from "../components/icons/LightweightGameIcons";
import courierHero from "../assets/facilities/messages-courier-hero.webp";
import { ReportControl } from "../components/ReportControl";
import type { Character } from "../types/character";
import { refreshUnreadMail } from "../lib/mail-unread";
import { GuestSocialLock } from "../components/GuestSocialLock";
import { useSocialLock } from "../lib/account-status";
import { gameConfirm } from "../components/GameAlert";

type DmMessage = { from: string; text: string; ts: number };
type InboxEntry = { with: string; lastTs: number; lastText: string; unread: number };

/** A read cut off by its own 12 s timeout failed; one retired by the screen did not. */
function timedOut(signal: AbortSignal): boolean {
    return signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
}

/** Same length and same last line: a poll that brought nothing new. */
function sameThread(a: readonly DmMessage[], b: readonly DmMessage[]): boolean {
    if (a.length !== b.length) return false;
    const x = a[a.length - 1], y = b[b.length - 1];
    return !x || !y || (x.ts === y.ts && x.from === y.from && x.text === y.text);
}

function timeAgo(ts: number): string {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

export const Messages = memo(function Messages({ character, onBack, initialWith, onConsumeInitialWith }: {
    character: Character;
    onBack: () => void;
    initialWith?: string | null;
    /** Called with null once the opening conversation is taken, so a later visit opens the inbox. */
    onConsumeInitialWith?: (cleared: null) => void;
}) {
    const me = character.name.toLowerCase();
    const [inbox, setInbox] = useState<InboxEntry[]>([]);
    // The inbox reads as empty only after the server has answered; before that
    // it is loading, and a first read that fails says so instead of "no mail".
    const [inboxState, setInboxState] = useState<"loading" | "ready" | "failed">("loading");
    const [active, setActive] = useState<string | null>(initialWith ? initialWith.toLowerCase() : null);
    const activeKey = active ? active.toLowerCase() : null;
    const [loadedThread, setLoadedThread] = useState<{ withName: string; messages: DmMessage[] } | null>(null);
    const [threadFailed, setThreadFailed] = useState<string | null>(null);
    const thread = loadedThread && loadedThread.withName === activeKey ? loadedThread.messages : null;
    const [draft, setDraft] = useState("");
    const [composeTo, setComposeTo] = useState(initialWith ?? "");
    const [busy, setBusy] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [blocked, setBlocked] = useState<Set<string>>(() => new Set());
    // Guests can still READ the mail they were sent — only sending is shut, so
    // the inbox and threads stay intact and only the composers go away.
    const { locked: sendLocked, loading: lockLoading } = useSocialLock(character.name);
    const composeDisabled = sendLocked || lockLoading;
    const threadRef = useRef<HTMLDivElement>(null);
    // `seenRef` remembers the open conversation's length so the shared unread
    // badge is re-read only when a conversation opens or grows, not on every
    // 8 s poll (each re-read is another GET /api/messages). `scrolledForRef`
    // and `nearBottomRef` keep a reader who scrolled up from being pulled back.
    const seenRef = useRef<{ key: string; count: number } | null>(null);
    const scrolledForRef = useRef<string | null>(null);
    const nearBottomRef = useRef(true);

    useEffect(() => { if (initialWith) onConsumeInitialWith?.(null); }, [initialWith, onConsumeInitialWith]);

    const loadInbox = useCallback(async (signal: AbortSignal) => {
        try {
            const r = await fetch("/api/messages", { signal });
            if (!r.ok) throw new Error(`Inbox read answered ${r.status}`);
            const j = await r.json();
            if (signal.aborted) return;
            setInbox(Array.isArray(j) ? j : []);
            setInboxState("ready");
        } catch {
            // Keep an inbox already on screen; the next poll retries either way.
            if (!signal.aborted || timedOut(signal)) setInboxState((state) => state === "ready" ? state : "failed");
        }
    }, []);
    const loadBlocks = useCallback(async (signal: AbortSignal) => {
        try {
            const r = await fetch("/api/player/blocks", { signal });
            if (!r.ok) return;
            const j = await r.json() as { blocked?: unknown };
            if (!signal.aborted) setBlocked(new Set(Array.isArray(j.blocked) ? j.blocked.map(String) : []));
        } catch { /* offline */ }
    }, []);
    const loadThread = useCallback(async (withName: string, signal: AbortSignal) => {
        const key = withName.toLowerCase();
        try {
            const r = await fetch(`/api/messages?with=${encodeURIComponent(withName)}`, { signal });
            if (!r.ok) throw new Error(`Conversation read answered ${r.status}`);
            const j = await r.json();
            if (signal.aborted) return;
            const messages: DmMessage[] = Array.isArray(j) ? j : [];
            // A poll that brought nothing new keeps the same array, so the list
            // neither re-renders nor scrolls under the reader.
            setLoadedThread((current) => current?.withName === key && sameThread(current.messages, messages) ? current : { withName: key, messages });
            setThreadFailed(null);
            // Reading a conversation marks it read server-side — nudge the
            // shared unread store so the nav badge clears without waiting a
            // full poll interval, but only when it opened or something arrived.
            const seen = seenRef.current;
            seenRef.current = { key, count: messages.length };
            if (!seen || seen.key !== key || messages.length > seen.count) refreshUnreadMail();
        } catch {
            if (!signal.aborted || timedOut(signal)) setThreadFailed(key);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void loadBlocks(controller.signal);
        return () => controller.abort();
    }, [loadBlocks, me]);
    // Back at the inbox: the next conversation opened is a fresh open.
    useEffect(() => {
        if (activeKey) return;
        seenRef.current = null;
        scrolledForRef.current = null;
        nearBottomRef.current = true;
    }, [activeKey]);
    // Own the initial read and subsequent polls together. Switching conversations
    // or starting a mutation retires both reads before they can replace newer UI.
    useEffect(() => {
        if (busy || deleting) return;
        const controller = new AbortController();
        const refresh = () => {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
            return Promise.all([loadInbox(signal), active ? loadThread(active, signal) : undefined]);
        };
        const stop = visiblePoll(refresh, 8000, 0.1, { immediate: true });
        return () => { controller.abort(); stop(); };
    }, [active, busy, deleting, loadInbox, loadThread, me]);
    // Jump to the newest line when a conversation opens, when the reader is
    // already at the bottom, or when the newest line is their own reply.
    useEffect(() => {
        const el = threadRef.current;
        if (!el || !thread || !activeKey) return;
        const ownLast = thread[thread.length - 1]?.from.toLowerCase() === me;
        if (scrolledForRef.current !== activeKey || nearBottomRef.current || ownLast) el.scrollTop = el.scrollHeight;
        scrolledForRef.current = activeKey;
    }, [thread, activeKey, me]);

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
                setLoadedThread({ withName: target.toLowerCase(), messages: await r.json() });
                setDraft("");
                setActive(target.toLowerCase());
            } else {
                const e = await r.json().catch(() => ({}));
                setError(typeof e.error === "string" ? e.error : "Could not send message.");
            }
        } catch {
            setError("Network error — please retry.");
        } finally {
            setBusy(false);
        }
    }, [busy]);

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
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not update this player.");
        } finally {
            setBusy(false);
        }
    }, [busy]);

    const deleteConversation = useCallback(async (target: string) => {
        const partner = target.toLowerCase();
        if (busy || deleting) return;
        const confirmed = await gameConfirm(
            `Delete your conversation with ${target}? This clears it from your inbox and hides its message history for you.`,
            { title: "Delete conversation", confirmLabel: "Delete", danger: true },
        );
        if (!confirmed) return;

        setDeleting(partner);
        setError("");
        try {
            const r = await fetch(`/api/messages?with=${encodeURIComponent(partner)}`, { method: "DELETE" });
            const data = await r.json().catch(() => ({})) as { error?: string };
            if (!r.ok) throw new Error(data.error || "Could not delete this conversation.");
            setInbox((current) => current.filter((entry) => entry.with.toLowerCase() !== partner));
            if (active?.toLowerCase() === partner) {
                setActive(null);
                setLoadedThread(null);
            }
            refreshUnreadMail();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not delete this conversation.");
        } finally {
            setDeleting(null);
        }
    }, [active, busy, deleting]);

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
                        <button onClick={() => { setActive(null); setError(""); setThreadFailed(null); }}>← Inbox</button>
                    </div>
                    <div ref={threadRef} onScroll={(e) => { const el = e.currentTarget; nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64; }} style={{ maxHeight: "50vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, padding: "4px 0" }}>
                        {thread === null ? (
                            threadFailed === activeKey
                                ? <p className="hint" role="status">This conversation could not be loaded. It will try again in a moment.</p>
                                : <LoadingState>Opening the conversation…</LoadingState>
                        ) : thread.length === 0 ? (
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
                            <input aria-label={`Reply to ${active}`} enterKeyHint="send" disabled={blocked.has(active) || composeDisabled} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(active, draft); }} placeholder={blocked.has(active) ? `${active} is blocked` : `Message ${active}…`} maxLength={500} style={{ flex: 1 }} />
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
                                <input aria-label="Recipient name" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="Recipient name" style={{ width: 160 }} />
                                <input aria-label="Message text" enterKeyHint="send" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(composeTo, draft); }} placeholder="Message…" maxLength={500} style={{ flex: "1 1 200px", minWidth: 0 }} />
                                <button disabled={busy || composeDisabled || !composeTo.trim() || !draft.trim()} onClick={() => void send(composeTo, draft)}>Send</button>
                            </div>
                        )}
                        {error && <p className="hint" style={{ color: "var(--red-400)", marginTop: 6 }}>{error}</p>}
                    </div>
                    <div className="summary-box">
                        <strong>Inbox</strong>
                        {inbox.length === 0 && inboxState === "loading" ? (
                            <LoadingState>Checking the courier desk for your letters…</LoadingState>
                        ) : inbox.length === 0 && inboxState === "failed" ? (
                            <p className="hint" role="status">Your inbox could not be loaded. It will try again in a moment.</p>
                        ) : inbox.length === 0 ? (
                            <EmptyState icon={<GiChatBubble size={30} style={{ color: "var(--sj-text-muted)" }} />}>No conversations yet.</EmptyState>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                                {inbox.map((e) => (
                                    <div key={e.with} style={{ display: "flex", alignItems: "stretch", gap: 6, minWidth: 0 }}>
                                        <button onClick={() => { setActive(e.with); setError(""); }} style={{ display: "flex", flex: 1, minWidth: 0, justifyContent: "space-between", alignItems: "center", textAlign: "left", padding: "6px 10px", background: e.unread > 0 ? "var(--slate-800)" : "transparent", border: "1px solid var(--slate-700)", borderRadius: 8 }}>
                                            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                                <strong style={{ color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{e.with}{e.unread > 0 ? ` (${e.unread})` : ""}</strong>
                                                <small style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>{e.lastText}</small>
                                            </span>
                                            <small style={{ color: "var(--text-muted)", flexShrink: 0, marginLeft: 8 }}>{timeAgo(e.lastTs)}</small>
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Delete conversation with ${e.with}`}
                                            title={`Delete conversation with ${e.with}`}
                                            disabled={busy || deleting !== null}
                                            onClick={() => void deleteConversation(e.with)}
                                            style={{ width: 42, flex: "0 0 42px", display: "grid", placeItems: "center", padding: 0, color: "#fca5a5", border: "1px solid rgba(248, 113, 113, .45)", borderRadius: 8, background: "rgba(127, 29, 29, .14)" }}
                                        >
                                            <GiTrashCan size={17} aria-hidden="true" />
                                        </button>
                                    </div>
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
