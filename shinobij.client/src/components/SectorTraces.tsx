/*
 * SectorTraces — the "world remembers you" layer of a wild sector:
 *
 *   • <SectorTraceMarkers>  — small wooden trail-sign markers pinned to the tiles
 *     players left notes on (tap to read), drawn over the board like wanderers.
 *   • <SectorShrineStandee> — the sector's shrine as a 2.5D standee on the board
 *     (shrine sectors only, shared/shrines.ts), glowing brighter with its tier.
 *   • <SectorTracesCard>    — command-panel card: today's footfall, sign count,
 *     shrine tier + weekly top offerer at a glance.
 *   • <SectorTracesModal>   — portaled reader: browse/spark signs, leave your own,
 *     and make shrine offerings (a pure ryo sink for prestige).
 *
 * All data is server-authoritative (api/sector/traces + trail-sign + shrine-offer);
 * this file only renders and calls. Feature-gated by sectorTraces.v1 (default ON).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SHRINE_TIERS, shrineForSector, type ShrineDef } from "../../../shared/shrines";
import {
    leaveTrailSign,
    offerAtShrine,
    sparkTrailSign,
    type SectorTracesView,
    type TrailSignView,
} from "../lib/sector-traces";

const GRID = 12;
const SIGN_TEXT_MAX = 120;
const OFFER_PRESETS = [100, 1_000, 10_000] as const;

function timeAgo(at: number, now = Date.now()): string {
    const mins = Math.max(0, Math.floor((now - at) / 60_000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function tierName(tier: number): string {
    return SHRINE_TIERS[Math.max(0, Math.min(SHRINE_TIERS.length - 1, tier))].name;
}

/* ————— board markers ————— */

export function SectorTraceMarkers({ signs, onOpen }: {
    signs: TrailSignView[];
    onOpen: (signId: string) => void;
}) {
    // Group by tile so stacked signs render one marker with a count badge.
    const byTile = useMemo(() => {
        const map = new Map<number, TrailSignView[]>();
        for (const sign of signs) map.set(sign.tile, [...(map.get(sign.tile) ?? []), sign]);
        return [...map.entries()];
    }, [signs]);
    if (byTile.length === 0) return null;

    return (
        <div className="sector-trace-overlay" aria-hidden={false}>
            {byTile.map(([tile, tileSigns]) => {
                const col = tile % GRID;
                const row = Math.floor(tile / GRID);
                const left = ((col + 0.5) / GRID) * 100;
                const top = ((row + 0.5) / GRID) * 100;
                const newest = tileSigns[tileSigns.length - 1];
                return (
                    <button
                        type="button"
                        key={tile}
                        className="sector-trace-sign"
                        style={{ left: `${left}%`, top: `${top}%` }}
                        title={`${newest.name}: “${newest.text}”`}
                        aria-label={`Read trail sign by ${newest.name}`}
                        onClick={() => onOpen(newest.id)}
                    >
                        <img src="/landmarks/trail-sign.webp" alt="" draggable={false}
                            onError={(e) => { e.currentTarget.style.display = "none"; (e.currentTarget.nextElementSibling as HTMLElement | null)?.classList.add("is-visible"); }} />
                        <span className="sector-trace-sign-fallback">🪧</span>
                        {tileSigns.length > 1 && <b className="sector-trace-sign-count">{tileSigns.length}</b>}
                    </button>
                );
            })}
        </div>
    );
}

export function SectorShrineStandee({ shrine, tier, onOpen }: {
    shrine: ShrineDef;
    tier: number;
    onOpen: () => void;
}) {
    return (
        <button
            type="button"
            className={`atlas-landmark sector-shrine-standee shrine-tier-${tier} shrine-theme-${shrine.theme}`}
            style={{ left: `${shrine.left}%`, top: `${shrine.top}%` }}
            onClick={onOpen}
            title={`${shrine.name} — ${tierName(tier)}. Make an offering?`}
        >
            <img src={`/landmarks/shrine-${shrine.id}.webp`} alt="" draggable={false} />
            <span>{shrine.name.replace(/ Shrine$/, "")}</span>
        </button>
    );
}

/* ————— command-panel card ————— */

export function SectorTracesCard({ traces, onOpenSigns, onOpenShrine }: {
    traces: SectorTracesView | null;
    onOpenSigns: () => void;
    onOpenShrine: () => void;
}) {
    if (!traces) return null;
    const top = traces.shrine?.topWeek[0];
    return (
        <section className="summary-box sector-panel-card sector-traces-card">
            <div className="sector-panel-card-head">
                <h4>Traces</h4>
                <span className="sector-footfall-pill" title="Shinobi who arrived in this sector today">
                    {traces.footfallToday > 0 ? `${traces.footfallToday} passed today` : "quiet today"}
                </span>
            </div>
            <button type="button" className="sector-action-btn sector-trace-btn" onClick={onOpenSigns}>
                <span aria-hidden="true">🪧</span>
                <span>{traces.signs.length > 0 ? `Trail signs (${traces.signs.length})` : "Leave a trail sign"}</span>
            </button>
            {traces.shrine && (
                <button type="button" className="sector-action-btn sector-trace-btn" onClick={onOpenShrine}>
                    <span aria-hidden="true">⛩️</span>
                    <span>{traces.shrine.name} · {tierName(traces.shrine.tier)}{top ? ` · ${top.name} leads` : ""}</span>
                </button>
            )}
        </section>
    );
}

/* ————— portaled reader / composer / shrine ————— */

export type TracesModalState = { view: "signs" | "shrine"; focusSignId?: string };

export function SectorTracesModal({ state, traces, playerName, playerRyo, sectorIsCurrent, playerTile, onClose, onTraces, onRyo }: {
    state: TracesModalState;
    traces: SectorTracesView;
    playerName: string;
    playerRyo: number;
    sectorIsCurrent: boolean;
    playerTile: number;
    onClose: () => void;
    onTraces: (next: SectorTracesView) => void;
    onRyo: (ryo: number) => void;
}) {
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const [customOffer, setCustomOffer] = useState("");
    const focusRef = useRef<HTMLDivElement | null>(null);
    const shrine = traces.shrine;
    const def = shrineForSector(traces.sector);

    useEffect(() => {
        focusRef.current?.scrollIntoView({ block: "center" });
    }, [state.focusSignId]);

    async function submitSign() {
        const text = draft.trim();
        if (!text || busy) return;
        setBusy(true); setNote(null);
        const result = await leaveTrailSign(playerName, traces.sector, playerTile, text);
        setBusy(false);
        if (result.ok) {
            setDraft("");
            setNote("Your sign is planted on the trail.");
            onTraces({ ...traces, signs: result.signs });
        } else {
            setNote(result.message);
        }
    }

    async function spark(sign: TrailSignView) {
        if (busy || sign.name === playerName || traces.mySparked.includes(sign.id)) return;
        setBusy(true);
        const result = await sparkTrailSign(playerName, traces.sector, sign.id);
        setBusy(false);
        if (result.ok) {
            onTraces({
                ...traces,
                mySparked: [...traces.mySparked, sign.id],
                signs: traces.signs.map((s) => (s.id === sign.id ? { ...s, sparks: result.sparks ?? s.sparks + 1 } : s)),
            });
        }
    }

    async function offer(amount: number) {
        if (!shrine || busy) return;
        if (!sectorIsCurrent) { setNote("Travel to this sector to make an offering."); return; }
        if (amount > playerRyo) { setNote("Not enough ryo on hand."); return; }
        setBusy(true); setNote(null);
        const result = await offerAtShrine(playerName, shrine.id, amount);
        setBusy(false);
        if (result.ok) {
            onRyo(result.ryo);
            onTraces({ ...traces, shrine: result.shrine });
            setNote(`${def?.blessing ?? "The shrine accepts your offering."}`);
        } else {
            setNote(result.message);
        }
    }

    const nextTier = shrine && shrine.tier < SHRINE_TIERS.length - 1 ? SHRINE_TIERS[shrine.tier + 1] : null;
    const tierFloor = shrine ? SHRINE_TIERS[shrine.tier].at : 0;
    const tierProgress = shrine && nextTier
        ? Math.min(100, Math.round(((shrine.total - tierFloor) / (nextTier.at - tierFloor)) * 100))
        : 100;

    return createPortal(
        <div className="sector-traces-scrim" onClick={onClose}>
            <div className="sector-traces-sheet card" role="dialog" aria-modal="true" aria-label={state.view === "shrine" ? shrine?.name : "Trail signs"} onClick={(e) => e.stopPropagation()}>
                {state.view === "shrine" && shrine && def ? (
                    <>
                        <header className="sector-traces-head">
                            <img className="sector-traces-shrine-art" src={`/landmarks/shrine-${shrine.id}.webp`} alt="" />
                            <div>
                                <h3>{shrine.name}</h3>
                                <p className="sector-traces-sub">
                                    {shrine.village ? `${shrine.village} · ` : ""}{shrine.region} · <b className={`shrine-tier-label shrine-tier-${shrine.tier}`}>{tierName(shrine.tier)}</b>
                                </p>
                                <p className="sector-traces-blessing">“{shrine.blessing}”</p>
                            </div>
                        </header>
                        <p className={`sector-traces-lore is-${shrine.theme}`}>{shrine.lore}</p>
                        <div className="sector-meter-block">
                            <div className="sector-meter-row">
                                <span>{nextTier ? `Toward ${nextTier.name}` : "Fully awakened"}</span>
                                <strong>{shrine.total.toLocaleString()} ryo offered all-time</strong>
                            </div>
                            <div className="sector-meter sector-meter-control"><span style={{ width: `${tierProgress}%` }} /></div>
                        </div>
                        <div className="sector-traces-board">
                            <h4>This week's offerings · {shrine.weekTotal.toLocaleString()} ryo</h4>
                            {shrine.topWeek.length === 0
                                ? <p className="sector-empty-note">No offerings yet this week — be the first.</p>
                                : shrine.topWeek.map((o, i) => (
                                    <p key={o.name} className="sector-traces-board-row">
                                        <span>{i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "·"} {o.name}</span>
                                        <b>{o.amount.toLocaleString()}</b>
                                    </p>
                                ))}
                            {shrine.lastWeek?.topWeek[0] && (
                                <p className="sector-traces-lastweek">Last week's patron: <b>{shrine.lastWeek.topWeek[0].name}</b> ({shrine.lastWeek.topWeek[0].amount.toLocaleString()} ryo)</p>
                            )}
                        </div>
                        <div className="sector-traces-offer">
                            {OFFER_PRESETS.map((amount) => (
                                <button type="button" key={amount} className="sector-action-btn" disabled={busy || !sectorIsCurrent || amount > playerRyo} onClick={() => offer(amount)}>
                                    Offer {amount.toLocaleString()}
                                </button>
                            ))}
                            <div className="sector-traces-custom">
                                <input
                                    type="number" min={10} max={250_000} placeholder="custom"
                                    value={customOffer} onChange={(e) => setCustomOffer(e.target.value)}
                                    aria-label="Custom offering amount"
                                />
                                <button type="button" className="sector-action-btn" disabled={busy || !sectorIsCurrent || !(Number(customOffer) >= 10)} onClick={() => offer(Math.floor(Number(customOffer)))}>
                                    Offer
                                </button>
                            </div>
                        </div>
                        {!sectorIsCurrent && <p className="sector-empty-note">You are scouting from afar — travel here to make an offering.</p>}
                        <p className="sector-traces-ryo">On hand: {playerRyo.toLocaleString()} ryo</p>
                    </>
                ) : (
                    <>
                        <header className="sector-traces-head">
                            <div>
                                <h3>Trail signs — Sector {traces.sector}</h3>
                                <p className="sector-traces-sub">{traces.footfallToday > 0 ? `${traces.footfallToday} shinobi passed through today.` : "No arrivals logged today."} Signs fade after three days.</p>
                            </div>
                        </header>
                        <div className="sector-traces-list">
                            {traces.signs.length === 0 && <p className="sector-empty-note">No signs on this trail yet. Leave the first one.</p>}
                            {[...traces.signs].reverse().map((sign) => {
                                const mine = sign.name === playerName;
                                const sparked = traces.mySparked.includes(sign.id);
                                const focused = state.focusSignId === sign.id;
                                return (
                                    <div key={sign.id} ref={focused ? focusRef : undefined} className={`sector-traces-sign-row${focused ? " is-focused" : ""}`}>
                                        <p className="sector-traces-sign-text">“{sign.text}”</p>
                                        <p className="sector-traces-sign-meta">
                                            <span>— {sign.name}{mine ? " (you)" : ""} · {timeAgo(sign.at)}</span>
                                            <button
                                                type="button"
                                                className={`sector-traces-spark${sparked ? " is-sparked" : ""}`}
                                                disabled={busy || mine || sparked}
                                                title={mine ? "Your own sign" : sparked ? "You appreciated this" : "Appreciate this sign"}
                                                onClick={() => spark(sign)}
                                            >
                                                ✨ {sign.sparks}
                                            </button>
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="sector-traces-compose">
                            <textarea
                                value={draft}
                                maxLength={SIGN_TEXT_MAX}
                                placeholder={sectorIsCurrent ? "Carve a note for travelers who pass this way…" : "Travel here to leave a sign."}
                                disabled={!sectorIsCurrent || busy}
                                onChange={(e) => setDraft(e.target.value)}
                            />
                            <div className="sector-traces-compose-row">
                                <small>{draft.length}/{SIGN_TEXT_MAX} · plants at your tile</small>
                                <button type="button" className="sector-action-btn" disabled={!sectorIsCurrent || busy || !draft.trim()} onClick={submitSign}>
                                    Plant sign
                                </button>
                            </div>
                        </div>
                    </>
                )}
                {note && <p className="sector-traces-note">{note}</p>}
                <button type="button" className="sector-traces-close" onClick={onClose} aria-label="Close">✕</button>
            </div>
        </div>,
        document.body,
    );
}
