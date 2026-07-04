/*
 * Clan Chat tab. Text-only chat with clanmates. Cost-conscious: it polls
 * (api/clan/chat/get) with a `since` cursor ONLY while this tab is mounted, and
 * visiblePoll pauses the poll whenever the browser tab is hidden — so it adds no
 * background traffic when a player isn't looking at the chat. Messages are a
 * server-capped ring buffer (last 50); the server stamps name + timestamp.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { visiblePoll } from "../lib/poll";
import { fetchClanChat, sendClanChat, type ClanChatMessage } from "../lib/clan-chat-api";

const CHAT_KEEP = 50;

export function ClanChat({ playerName, clan }: { playerName: string; clan: string }) {
    const [messages, setMessages] = useState<ClanChatMessage[]>([]);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const sinceRef = useRef(0);
    const logRef = useRef<HTMLDivElement | null>(null);

    const merge = useCallback((incoming: ClanChatMessage[]) => {
        if (incoming.length === 0) return;
        setMessages(prev => {
            const seen = new Set(prev.map(m => m.id));
            const merged = [...prev];
            for (const m of incoming) if (!seen.has(m.id)) merged.push(m);
            merged.sort((a, b) => a.ts - b.ts);
            const capped = merged.slice(-CHAT_KEEP);
            if (capped.length) sinceRef.current = capped[capped.length - 1].ts;
            return capped;
        });
    }, []);

    // Poll only while mounted; visiblePoll pauses when the tab is hidden.
    useEffect(() => {
        let alive = true;
        const check = () => fetchClanChat(playerName, clan, sinceRef.current).then(m => { if (alive) merge(m); }).catch(() => {});
        check();
        const stop = visiblePoll(check, 5000);
        return () => { alive = false; stop(); };
    }, [playerName, clan, merge]);

    // Keep the log pinned to the newest message.
    useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);

    async function send() {
        const t = text.trim();
        if (!t || busy) return;
        setBusy(true); setError("");
        const res = await sendClanChat(playerName, clan, t);
        setBusy(false);
        if (!res.ok) { setError(res.error ?? "Could not send your message."); return; }
        setText("");
        if (res.messages) merge(res.messages);
    }

    return (
        <div className="summary-box clan-chat">
            <h3 style={{ marginTop: 0 }}>Clan Chat</h3>
            <p className="hint" style={{ marginTop: 0 }}>Talk with your clanmates. The last {CHAT_KEEP} messages are kept.</p>
            <div className="clan-chat-log" ref={logRef}>
                {messages.length === 0
                    ? <p className="hint">No messages yet — say hello to your clan.</p>
                    : messages.map(m => (
                        <div key={m.id} className={`clan-chat-msg${m.name === playerName ? " self" : ""}`}>
                            <span className="clan-chat-name">{m.name}</span>
                            <span className="clan-chat-text">{m.text}</span>
                        </div>
                    ))}
            </div>
            {error && <p className="clan-chat-error">{error}</p>}
            <div className="clan-chat-input">
                <input
                    value={text}
                    maxLength={500}
                    placeholder="Message your clan…"
                    aria-label="Clan chat message"
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
                />
                <button onClick={() => void send()} disabled={busy || !text.trim()}>{busy ? "…" : "Send"}</button>
            </div>
        </div>
    );
}
