import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from 'react';
import { sectorName } from '../../../shared/sector-geo';
import { SECTOR_CHAT_MAX_CHARS } from '../../../shared/sector-chat';
import { useSectorChat } from '../lib/use-sector-chat';
import { sectorChatAge, sectorChatClock, sectorChatLayoutFor, shapeSectorChat, unreadSectorChat, type SectorChatLayout } from '../lib/sector-chat';
import { villageAccent } from '../lib/village-war-map';
import { useSocialLock } from '../lib/account-status';
import { useDismissGesture } from '../lib/use-dismiss-gesture';
import { ReportControl } from './ReportControl';
import { GuestSocialLock } from './GuestSocialLock';
import { SectorHudPanel } from './SectorHudPanel';
import type { SectorChatRefusal } from '../lib/sector-chat-api';

const NEAR_BOTTOM_PX = 48;

function refusalLine(refusal: SectorChatRefusal): string {
    if (refusal.silencedUntil) return `You are silenced until ${sectorChatClock(refusal.silencedUntil)}.`;
    if (refusal.status === 429) return `You are speaking too fast. Try again in ${Math.max(1, Math.ceil((refusal.retryAfterMs ?? 1000) / 1000))}s.`;
    if (refusal.status === 409) return 'Your voice cannot reach this sector yet. Give it a moment.';
    if (refusal.status === 0) return 'The message did not carry. Check your connection and try again.';
    return refusal.error;
}

/**
 * The voice of the sector: everyone standing here hears it, nobody else does.
 *
 * Where the HUD's nearby column has room the chat docks at its foot, under the
 * roster. Where it does not, the chat is a bar in that column and opens as a
 * sheet over the board through the same SectorHudPanel Sector Info uses; the
 * HUD owns which of the two sheets is open (`sheetOpen` / `onSheet`) so they
 * can never stack.
 */
export function SectorChat({ sector, present, playerName, hudRef, sheetOpen, onSheet }: {
    sector: number; present: boolean; playerName: string;
    hudRef: RefObject<HTMLDivElement | null>; sheetOpen: boolean; onSheet: (open: boolean) => void;
}) {
    const { messages, status, live, skewMs, send } = useSectorChat(sector, present);
    const { locked, loading } = useSocialLock(playerName);
    // Same click lease Sector Info keeps: a touch outside the sheet closes it
    // without that tap also landing on the board and walking the player.
    const consumeTouchClick = useDismissGesture();
    const rootRef = useRef<HTMLElement>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const logRef = useRef<HTMLDivElement>(null);
    const newestRef = useRef(0);
    const followsRoom = useRef(true);
    // null until the HUD has given the column a real height.
    const [layout, setLayout] = useState<SectorChatLayout | null>(null);
    const [dockedChoice, setDockedChoice] = useState<boolean | null>(null);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [notice, setNotice] = useState('');
    // Whether the reader is at the bottom of the log, and the newest line they
    // have had in front of them. Together they decide "N new" and the jump pill.
    const [pinned, setPinned] = useState(true);
    const [readTs, setReadTs] = useState(0);
    const [now, setNow] = useState(() => Date.now());
    const id = useId();
    const docked = layout === 'roomy';
    const open = docked ? dockedChoice ?? true : sheetOpen && layout !== null;
    const lines = shapeSectorChat(messages, playerName);
    const newest = messages.length ? messages[messages.length - 1].ts : 0;
    const unread = open ? 0 : unreadSectorChat(messages, readTs, playerName);
    const behind = open && !pinned && newest > readTs;
    const clock = now + skewMs;
    const place = sectorName(sector) ?? `Sector ${sector}`;

    useEffect(() => { newestRef.current = newest; }, [newest]);
    useEffect(() => { followsRoom.current = dockedChoice === null; }, [dockedChoice]);

    // Fit the room the HUD actually gave the column, not a breakpoint. Until
    // that room is known the chat stays a closed bar, so a phone never flashes
    // it open and a desktop opens it once instead of twice.
    useLayoutEffect(() => {
        const host = rootRef.current?.parentElement;
        if (!host) return undefined;
        let previous: SectorChatLayout | null = null;
        const measure = () => {
            const height = host.clientHeight;
            // This layout effect runs before the HUD's own, which is what sets
            // the column's height; a zero here means "not laid out yet".
            if (height <= 0) return;
            const next = sectorChatLayoutFor(height, previous);
            if (next === previous) return;
            // Folding out of the dock still counts as having seen what was open.
            if (previous === 'roomy' && followsRoom.current) setReadTs((ts) => Math.max(ts, newestRef.current));
            previous = next;
            setLayout(next);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(host);
        return () => observer.disconnect();
    }, []);

    // Relative times drift; repaint them every quarter minute.
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 15_000);
        return () => clearInterval(timer);
    }, []);

    // Follow the conversation unless the reader has scrolled up to reread, and
    // keep following it when the column or sheet resizes the log under them.
    useLayoutEffect(() => {
        const log = logRef.current;
        if (!log || !open || !pinned) return undefined;
        const follow = () => { log.scrollTop = log.scrollHeight; };
        follow();
        const observer = new ResizeObserver(follow);
        observer.observe(log);
        return () => observer.disconnect();
    }, [newest, open, pinned, docked]);

    if (status === 'unavailable') return null;

    const markRead = () => setReadTs((ts) => Math.max(ts, newest));
    const onScroll = () => {
        const log = logRef.current;
        if (!log) return;
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < NEAR_BOTTOM_PX;
        setPinned(atBottom);
        if (atBottom) markRead();
    };
    const jumpToNewest = () => {
        const log = logRef.current;
        if (log) log.scrollTop = log.scrollHeight;
        setPinned(true);
        markRead();
    };
    const toggle = () => {
        if (open) markRead();
        if (docked) setDockedChoice(!open);
        else { setPinned(true); onSheet(!open); }
    };
    const closeSheet = (restoreFocus = false, touch = false) => {
        if (touch) consumeTouchClick();
        markRead();
        onSheet(false);
        if (restoreFocus) toggleRef.current?.focus({ preventScroll: true });
    };
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const text = draft.trim();
        if (!text || sending) return;
        setSending(true); setNotice('');
        const refusal = await send(text);
        setSending(false);
        if (refusal) { setNotice(refusalLine(refusal)); return; }
        setDraft('');
        setPinned(true);
        setNow(Date.now());
    };

    const remaining = SECTOR_CHAT_MAX_CHARS - draft.length;
    const state = status === 'away' ? 'away' : live ? 'live' : 'polling';
    const stateLabel = state === 'away' ? 'Out of earshot' : state === 'live' ? 'Live' : 'Listening';
    const body = <div id={`${id}-body`} className="sector-chat-body">
        {status === 'away' ? <p className="sector-chat-empty" role="status">
            <b>You are scouting from afar.</b>Travel here to hear what is being said.
        </p> : <div className="sector-chat-frame">
            <div ref={logRef} className="sector-chat-log" role="log" aria-live="polite" aria-label={`Messages in ${place}`}
                tabIndex={0} onScroll={onScroll} onWheel={(event) => event.stopPropagation()}>
                {lines.length === 0 ? <p className="sector-chat-empty">
                    <b>{status === 'connecting' ? 'Listening…' : 'Quiet here.'}</b>
                    Anything you say reaches everyone in this sector and fades within the hour.
                </p> : <ol className="sector-chat-list">{lines.map((line) => <li key={line.id}
                    className={`sector-chat-line${line.own ? ' is-own' : ''}${line.continued ? ' is-continued' : ''}`}>
                    {!line.continued && <div className="sector-chat-meta">
                        <span className="sector-chat-sigil" aria-hidden="true"
                            style={{ '--sigil': villageAccent(line.village ?? '') } as CSSProperties} />
                        <b className="sector-chat-name">{line.name}</b>
                        {line.level ? <span className="sector-chat-level">Lv {line.level}</span> : null}
                        <time dateTime={new Date(line.ts).toISOString()} title={sectorChatClock(line.ts)}>{sectorChatAge(line.ts, clock)}</time>
                    </div>}
                    <p className="sector-chat-text">{line.text}</p>
                    {!line.own && <span className="sector-chat-report">
                        <ReportControl targetType="message" targetName={line.name} targetId={line.id} context={`sector-chat:${sector}`} />
                    </span>}
                </li>)}</ol>}
            </div>
            {behind && <button type="button" className="sector-chat-jump" onClick={jumpToNewest}>New messages</button>}
        </div>}
        {status !== 'away' && (locked
            ? <GuestSocialLock compact what="Guest characters can listen to sector chat but cannot speak in it." />
            : <form className="sector-chat-compose" onSubmit={(event) => { void submit(event); }}>
                <label className="sector-chat-field">
                    <span className="sector-chat-sr">Message everyone in {place}</span>
                    <input value={draft} maxLength={SECTOR_CHAT_MAX_CHARS} disabled={loading}
                        placeholder="Speak to the sector…" autoComplete="off" enterKeyHint="send"
                        onChange={(event) => { setDraft(event.target.value); if (notice) setNotice(''); }} />
                    {remaining <= 40 && <small className="sector-chat-count" aria-live="polite">{remaining}</small>}
                </label>
                <button type="submit" className="sector-chat-send" aria-label="Send message" disabled={sending || loading || !draft.trim()}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 11.1 19.6 4.2c.8-.3 1.5.4 1.2 1.2l-6.9 16.2c-.3.8-1.4.8-1.7 0l-2.2-6-6-2.2c-.8-.3-.8-1.4-.1-1.7Zm6.9 2.3 1.6 4.4 4.9-11.5-11.5 4.9 4.4 1.6 3-3a.7.7 0 1 1 1 1l-3.4 2.6Z" /></svg>
                </button>
            </form>)}
        {notice && <p className="sector-chat-notice" role="status">{notice}</p>}
    </div>;

    return <section ref={rootRef} className={`sector-chat${open ? ' is-open' : ''}`} data-layout={layout ?? 'compact'}
        aria-labelledby={`${id}-title`}>
        <h3 className="sector-chat-head">
            <button ref={toggleRef} type="button" className="sector-chat-toggle" aria-expanded={open}
                aria-controls={docked ? `${id}-body` : `${id}-sheet`} aria-haspopup={docked ? undefined : 'dialog'}
                aria-label={`Sector chat, ${stateLabel}${unread > 0 ? `, ${unread} new` : ''}`} onClick={toggle}>
                <span id={`${id}-title`} className="sector-chat-title">Sector chat</span>
                <span className="sector-chat-state" data-state={state}><i aria-hidden="true" />{stateLabel}</span>
                {unread > 0 && <span className="sector-chat-unread">{unread > 9 ? '9+' : unread} new</span>}
                <span className="sector-chat-chevron" aria-hidden="true" />
            </button>
        </h3>
        {open && (docked ? body : <SectorHudPanel id={`${id}-sheet`} title="Sector chat" rootRef={hudRef} onClose={closeSheet}>{body}</SectorHudPanel>)}
    </section>;
}
