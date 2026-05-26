import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
    type Character,
    type Screen,
    type TavernMessage,
} from "../App";

export 
function VillageTavern({ character, setScreen, sharedImages }: { character: Character; setScreen: (s: Screen) => void; sharedImages: Record<string, string> }) {
    const [messages, setMessages] = useState<TavernMessage[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(true);
    const bottomRef = useRef<HTMLDivElement>(null);
    // Track last known message count so we skip re-renders when nothing changed
    const lastCountRef = useRef<number>(-1);

    async function fetchMessages() {
        try {
            const res = await fetch(`/api/village/chat?village=${encodeURIComponent(character.village)}`);
            if (!res.ok) return;
            // Server sends X-Message-Count so we can skip JSON parse when unchanged
            const count = Number(res.headers.get("X-Message-Count") ?? -1);
            if (count !== -1 && count === lastCountRef.current) return;
            const data: TavernMessage[] = await res.json();
            lastCountRef.current = data.length;
            setMessages(data);
        } catch { /* silently ignore network errors */ }
        finally { setLoading(false); }
    }

    // Load on mount + poll every 30s; pause completely when tab is in the background
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchMessages syncs to external system (server)
        void fetchMessages();
        let interval: ReturnType<typeof setInterval> | null = setInterval(() => {
            if (!document.hidden) void fetchMessages();
        }, 30_000);

        function handleVisibility() {
            if (document.hidden) {
                // Tab hidden — stop polling to save KV reads
                if (interval) { clearInterval(interval); interval = null; }
            } else {
                // Tab visible again — fetch immediately then resume polling
                void fetchMessages();
                if (!interval) interval = setInterval(() => {
                    if (!document.hidden) void fetchMessages();
                }, 30_000);
            }
        }
        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            if (interval) clearInterval(interval);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character.village]);

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

    async function send() {
        const text = input.trim();
        if (!text || sending) return;
        setSending(true);
        setInput("");
        try {
            const res = await fetch(`/api/village/chat?village=${encodeURIComponent(character.village)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    author: character.name,
                    text,
                    rank: character.rankTitle,
                    customTitle: character.customTitle,
                    level: character.level,
                }),
            });
            if (res.ok) setMessages(await res.json());
        } catch { /* ignore */ }
        setSending(false);
    }

    return (
        <div className="card tavern-screen">
            <div className="tavern-header">
                <button className="back-button" onClick={() => setScreen("village")}>? Village</button>
                <div>
                    <h2>🍶 {character.village} Tavern</h2>
                    <p className="tavern-subtitle">Village members only — speak freely.</p>
                </div>
            </div>
            <div className="tavern-log">
                {loading && <p className="tavern-empty">Loading messages…</p>}
                {!loading && messages.length === 0 && <p className="tavern-empty">The tavern is quiet. Be the first to speak.</p>}
                {messages.map((m, i) => {
                    const avatar = sharedImages['avatar:' + m.author.toLowerCase()] || (m.author === character.name ? character.avatarImage : '');
                    return (
                        <div key={i} className={`tavern-message ${m.author === character.name ? "tavern-mine" : ""}`}>
                            <div className="tavern-avatar-col">
                                <div className="tavern-avatar">
                                    {avatar
                                        ? <img src={avatar} alt={m.author} />
                                        : <span>{m.author.slice(0, 2).toUpperCase()}</span>}
                                </div>
                                {m.level != null && <div className="tavern-level-badge">Lv{m.level}</div>}
                            </div>
                            <div className="tavern-body">
                                <div className="tavern-meta">
                                    <span className="tavern-author">{m.author}</span>
                                    {m.customTitle && <span className="tavern-custom-title">?{m.customTitle}?</span>}
                                    {m.rank && <span className="tavern-rank">{m.rank}</span>}
                                    <span className="tavern-time">{new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                </div>
                                <p className="tavern-text">{m.text}</p>
                            </div>
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>
            <div className="tavern-input-row">
                <input
                    className="tavern-input"
                    value={input}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
                    placeholder={`Say something to ${character.village}...`}
                    maxLength={300}
                    disabled={sending}
                />
                <button className="tavern-send-btn" onClick={() => void send()} disabled={!input.trim() || sending}>
                    {sending ? "…" : "? Send"}
                </button>
            </div>
        </div>
    );
}
