/*
 * Clan Chat tab. Text-only chat with clanmates. Cost-conscious: it fetches
 * (api/clan/chat/get) with a `since` cursor ONLY while this tab is mounted —
 * on a socket hint when a clanmate posts, and on a slow reconcile poll that
 * pauses whenever the browser tab is hidden (lib/use-clan-chat-feed.ts). So it
 * adds no background traffic when a player isn't looking at the chat. Messages
 * are a server-capped ring buffer (last 50); the server stamps name + timestamp.
 */
import { useEffect, useRef, useState } from "react";
import { CLAN_CHAT_SEND_FAILED, sendClanChat } from "../lib/clan-chat-api";
import { CLAN_CHAT_KEEP, useClanChatFeed } from "../lib/use-clan-chat-feed";
import { ReportControl } from "../components/ReportControl";
import { GuestSocialLock } from "../components/GuestSocialLock";
import { useSocialLock } from "../lib/account-status";

export function ClanChat({ playerName, clan }: { playerName: string; clan: string }) {
    const { messages, merge } = useClanChatFeed(playerName, clan);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    // Reading the clan's chat stays open; only posting is gated.
    const { locked: sendLocked, loading: lockLoading } = useSocialLock(playerName);
    const logRef = useRef<HTMLDivElement | null>(null);

    // Keep the log pinned to the newest message.
    useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);

    async function send() {
        const t = text.trim();
        if (!t || busy) return;
        setBusy(true); setError("");
        const res = await sendClanChat(playerName, clan, t);
        setBusy(false);
        if (!res.ok) { setError(res.error ?? CLAN_CHAT_SEND_FAILED); return; }
        setText("");
        if (res.messages) merge(res.messages);
    }

    return (
        <div className="summary-box clan-chat">
            <h3 style={{ marginTop: 0 }}>Clan Chat</h3>
            <p className="hint" style={{ marginTop: 0 }}>Talk with your clanmates. The last {CLAN_CHAT_KEEP} messages are kept.</p>
            <div className="clan-chat-log" ref={logRef}>
                {messages.length === 0
                    ? <p className="hint">No messages yet — say hello to your clan.</p>
                    : messages.map(m => (
                        <div key={m.id} className={`clan-chat-msg${m.name === playerName ? " self" : ""}`}>
                            <span className="clan-chat-name">{m.name}</span>
                            <span className="clan-chat-text">{m.text}</span>
                            {m.name !== playerName && (
                                <ReportControl targetType="clan-chat" targetName={m.name} targetId={m.id} context="clan-chat" style={{ marginLeft: "auto" }} />
                            )}
                        </div>
                    ))}
            </div>
            {error && <p className="clan-chat-error">{error}</p>}
            {sendLocked ? (
                <GuestSocialLock compact what="Guest characters can follow their clan's chat but cannot post to it." />
            ) : (
                <div className="clan-chat-input">
                    <input
                        value={text}
                        maxLength={500}
                        placeholder="Message your clan…"
                        aria-label="Clan chat message"
                        disabled={lockLoading}
                        onChange={e => setText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
                    />
                    <button onClick={() => void send()} disabled={busy || lockLoading || !text.trim()}>{busy ? "Sending…" : "Send"}</button>
                </div>
            )}
        </div>
    );
}
