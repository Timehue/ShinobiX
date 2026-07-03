import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
    type Character,
    type TavernMessage,
} from "../App";
import { type PlayerRecord } from "../types/character";
import { titleStyleColor, RARITY_COLORS, isLegacyServerLive, type LegacyRarity } from "../lib/legacy";
import { tavernGossipLine } from "../lib/legacy-rumors";

// Server-added optional fields (api/village/chat.ts ChatMessage): paid title
// cosmetics + legacy prestige derived from the author's save, and the
// server-authored `system` flag on World Herald lines (never settable by
// players).
type TavernMsg = TavernMessage & {
    customTitleStyle?: string;
    customTitleIcon?: string;
    legacyStage?: number;
    legacyRarity?: string;
    system?: boolean;
};

const STAGE_ROMAN = ["", "I", "II", "III", "IV", "V"];

export
function VillageTavern({ character, onBack, sharedImages, onViewProfile, playerRoster }: { character: Character; onBack: () => void; sharedImages: Record<string, string>; onViewProfile?: (name: string) => void; playerRoster: PlayerRecord[] }) {
    const [messages, setMessages] = useState<TavernMsg[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(true);
    // The message the player is replying to (null = a fresh, un-quoted message).
    const [replyingTo, setReplyingTo] = useState<TavernMsg | null>(null);
    // The village's currently seated Kage (fetched once on mount) — used to
    // badge that author's messages live, regardless of the stale snapshot the
    // message was posted with.
    const [seatedKage, setSeatedKage] = useState<string | null>(null);
    // Rotating "gossip of the day" strip — a second Legacy discovery surface.
    // Only shown once the server confirms Legacy is live (isLegacyServerLive
    // caches a single probe); world-flavored, never this player's stats.
    const [gossip, setGossip] = useState<string | null>(null);
    const logRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // Track last known message count so we skip re-renders when nothing changed
    const lastCountRef = useRef<number>(-1);
    // …and the newest message ts: at the 30-message cap every append keeps the
    // count constant, so count alone would hide new lines (e.g. World Herald
    // broadcasts). Server sends X-Last-Ts alongside X-Message-Count.
    const lastTsRef = useRef<number>(-1);

    // Live identity lookup: name → the roster's CURRENT character, so a message
    // shows the author's live level/rank/title instead of the values frozen in
    // at post time. Falls back to the message snapshot when the author isn't in
    // the roster (offline / not yet loaded). Zero extra server cost — the roster
    // is already polled by the app shell. Self is always included so the
    // player's own messages update the instant they level.
    const liveByName = useMemo(() => {
        const map = new Map<string, Character>();
        for (const p of playerRoster) {
            if (p?.name && p.character) map.set(p.name.toLowerCase(), p.character);
        }
        map.set(character.name.toLowerCase(), character);
        return map;
    }, [playerRoster, character]);

    // Newest first — the tavern reads top-to-bottom with the latest message on
    // top. The server stores oldest→newest, so reverse a shallow copy.
    const ordered = useMemo(() => messages.slice().reverse(), [messages]);

    function startReply(m: TavernMsg) {
        setReplyingTo(m);
        // Focus the box so the mobile keyboard opens straight onto the reply.
        inputRef.current?.focus();
    }

    async function fetchMessages() {
        try {
            const res = await fetch(`/api/village/chat?village=${encodeURIComponent(character.village)}`);
            if (!res.ok) return;
            // Server sends X-Message-Count + X-Last-Ts so we can skip the JSON
            // parse when nothing changed. Both must match: at the cap the count
            // never moves, only the newest ts does. Older servers without
            // X-Last-Ts fall back to the count-only check (lastTs stays -1).
            const count = Number(res.headers.get("X-Message-Count") ?? -1);
            const lastTs = Number(res.headers.get("X-Last-Ts") ?? -1);
            if (count !== -1 && count === lastCountRef.current && (lastTs === -1 || lastTs === lastTsRef.current)) return;
            const parsed = await res.json();
            const data: TavernMsg[] = Array.isArray(parsed) ? parsed : [];
            lastCountRef.current = data.length;
            lastTsRef.current = data.length ? data[data.length - 1].ts : 0;
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

    // Fetch the seated Kage once per village. Cheap (server caches the kage key
    // ~30s) and one request per visit, not per poll — Kage changes are rare.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch(`/api/village/kage?village=${encodeURIComponent(character.village)}`);
                if (!res.ok) return;
                const data = await res.json().catch(() => null) as { seatedKage?: unknown } | null;
                if (!cancelled) setSeatedKage(typeof data?.seatedKage === "string" ? data.seatedKage : null);
            } catch { /* ignore — the badge just won't show */ }
        })();
        return () => { cancelled = true; };
    }, [character.village]);

    // Newest is on top, so jump the log to the top when a new message arrives
    // (fetchMessages only calls setMessages when the count actually changed, so
    // this never yanks a player who's merely re-polling with no new messages).
    useEffect(() => { logRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, [messages]);

    // Legacy tavern gossip — probe once whether the server has Legacy live, then
    // pick today's line. Skipped entirely (strip hidden) when Legacy is off, so
    // a rollback never leaves misleading legend-talk in the tavern.
    useEffect(() => {
        let alive = true;
        void isLegacyServerLive().then((live) => {
            if (!alive || !live) return;
            const dayBucket = Math.floor(Date.now() / 86_400_000);
            setGossip(tavernGossipLine(character.name, dayBucket));
        });
        return () => { alive = false; };
    }, [character.name]);

    async function send() {
        const text = input.trim();
        if (!text || sending) return;
        setSending(true);
        setInput("");
        // Capture + clear the reply target before the request so a fast
        // follow-up message isn't accidentally sent as a reply too.
        const reply = replyingTo;
        setReplyingTo(null);
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
                    ...(reply ? { replyTo: { author: reply.author, text: reply.text } } : {}),
                }),
            });
            if (res.ok) {
                setMessages(await res.json());
            } else {
                // Surface the server rejection (silenced, rate-limited, 5xx)
                // AND restore the typed text so the player can edit/retry.
                // Previously the cleared input + silent failure made it
                // look like the message just vanished.
                const errData = await res.json().catch(() => ({} as { error?: string }));
                alert(errData?.error ?? `Failed to send (${res.status}).`);
                setInput(text);
                setReplyingTo(reply);
            }
        } catch {
            alert("Network error — message not sent.");
            setInput(text);
            setReplyingTo(reply);
        }
        setSending(false);
    }

    return (
        <div className="card tavern-screen">
            <div className="tavern-header">
                <button className="back-button" onClick={onBack}>← Back</button>
                <div>
                    <h2>🍶 {character.village} Tavern</h2>
                    <p className="tavern-subtitle">Village members only — speak freely.</p>
                </div>
            </div>
            {gossip && (
                <div
                    className="tavern-gossip"
                    style={{
                        margin: "0 0 10px", padding: "8px 12px", borderRadius: 8,
                        border: "1px solid rgba(192,132,252,.28)", background: "rgba(192,132,252,.07)",
                        fontSize: ".82rem", fontStyle: "italic", color: "#c9b8e8", lineHeight: 1.4,
                    }}
                >
                    <span style={{ fontStyle: "normal", opacity: .7, marginRight: 6 }}>🗣️ Overheard</span>
                    {gossip}
                </div>
            )}
            <div className="tavern-log" ref={logRef}>
                {loading && <p className="tavern-empty">Loading messages…</p>}
                {!loading && messages.length === 0 && <p className="tavern-empty">The tavern is quiet. Be the first to speak.</p>}
                {ordered.map((m) => {
                    const avatar = sharedImages['avatar:' + m.author.toLowerCase()] || (m.author === character.name ? character.avatarImage : '');
                    // Live identity — falls back to the message's post-time snapshot.
                    const live = liveByName.get(m.author.toLowerCase());
                    const level = live?.level ?? m.level;
                    const rankTitle = live?.rankTitle ?? m.rank;
                    const customTitle = live?.customTitle ?? m.customTitle;
                    // Paid title cosmetics follow the same live-first rule.
                    const titleStyle = live?.customTitleStyle ?? m.customTitleStyle;
                    const titleIcon = live?.customTitleIcon ?? m.customTitleIcon;
                    const isKage = !!seatedKage && m.author.toLowerCase() === seatedKage.toLowerCase();
                    return (
                        <div key={`${m.ts}-${m.author}`} className={`tavern-message ${m.author === character.name ? "tavern-mine" : ""}${m.system ? " tavern-herald" : ""}`}>
                            <div className="tavern-avatar-col">
                                <div
                                    className="tavern-avatar"
                                    onClick={() => onViewProfile?.(m.author)}
                                    style={onViewProfile ? { cursor: "pointer" } : undefined}
                                    title={onViewProfile ? `View ${m.author}'s profile` : undefined}
                                >
                                    {avatar
                                        ? <img src={avatar} alt={m.author} />
                                        : <span>{m.author.slice(0, 2).toUpperCase()}</span>}
                                </div>
                                {level != null && <div className="tavern-level-badge">Lv{level}</div>}
                            </div>
                            <div className="tavern-body">
                                <div className="tavern-meta">
                                    <span
                                        className="tavern-author"
                                        onClick={() => onViewProfile?.(m.author)}
                                        role={onViewProfile ? "button" : undefined}
                                        tabIndex={onViewProfile ? 0 : undefined}
                                        onKeyDown={(e) => { if (onViewProfile && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onViewProfile(m.author); } }}
                                        style={onViewProfile ? { cursor: "pointer" } : undefined}
                                        title={onViewProfile ? `View ${m.author}'s profile` : undefined}
                                    >{m.author}</span>
                                    {isKage && <span className="tavern-kage" title={`${character.village} Kage`}>👑 Kage</span>}
                                    {rankTitle && <span className="tavern-rank">{rankTitle}</span>}
                                    {customTitle && (
                                        <span className="tavern-custom-title" style={titleStyle ? { color: titleStyleColor(titleStyle) } : undefined}>
                                            «{titleIcon ? `${titleIcon} ` : ""}{customTitle}»
                                        </span>
                                    )}
                                    {/* Legacy prestige chip — message-derived ONLY (the server
                                        stamps it from the author's save, so it can't be spoofed;
                                        presence copies are client-claimed). */}
                                    {(m.legacyStage ?? 0) >= 2 && (
                                        <span
                                            title={`Legacy — Stage ${STAGE_ROMAN[m.legacyStage!] ?? m.legacyStage}`}
                                            style={{ fontSize: ".72rem", fontWeight: 800, color: RARITY_COLORS[(m.legacyRarity as LegacyRarity)] ?? "#c084fc" }}
                                        >★{STAGE_ROMAN[m.legacyStage!] ?? m.legacyStage}</span>
                                    )}
                                    <span className="tavern-time">{new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                    <button
                                        type="button"
                                        className="tavern-reply-btn"
                                        onClick={() => startReply(m)}
                                        aria-label={`Reply to ${m.author}`}
                                    >↩ Reply</button>
                                </div>
                                {m.replyTo && (
                                    <div className="tavern-quote">
                                        <span className="tavern-quote-author">↩ {m.replyTo.author}</span>
                                        <span className="tavern-quote-text">{m.replyTo.text}</span>
                                    </div>
                                )}
                                <p className="tavern-text">{m.text}</p>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="tavern-compose">
                {replyingTo && (
                    <div className="tavern-reply-banner">
                        <div className="tavern-reply-banner-info">
                            <span className="tavern-reply-banner-label">Replying to {replyingTo.author}</span>
                            <span className="tavern-reply-banner-text">{replyingTo.text}</span>
                        </div>
                        <button
                            type="button"
                            className="tavern-reply-cancel"
                            onClick={() => setReplyingTo(null)}
                            aria-label="Cancel reply"
                        >✕</button>
                    </div>
                )}
                <div className="tavern-input-row">
                    <input
                        ref={inputRef}
                        className="tavern-input"
                        value={input}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
                        placeholder={replyingTo ? `Reply to ${replyingTo.author}...` : `Say something to ${character.village}...`}
                        maxLength={300}
                        disabled={sending}
                    />
                    <button className="tavern-send-btn" onClick={() => void send()} disabled={!input.trim() || sending}>
                        {sending ? "…" : "→ Send"}
                    </button>
                </div>
            </div>
        </div>
    );
}
