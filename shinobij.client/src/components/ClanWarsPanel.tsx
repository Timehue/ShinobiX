/* eslint-disable react-hooks/set-state-in-effect -- intentional fetch-on-mount +
   20s interval refresh; verbatim move from App.tsx, which carries the same
   file-level disable for this idiomatic data-fetch effect. */
import { useCallback, useEffect, useState } from "react";
import { cwListWars, type CwWar } from "../lib/clan-war-api";
import { ClanWarManual } from "./ClanWarManual";
import { CW_HP_MAX, CW_DAMAGE } from "../constants/clan";
import { clanStoresReadout, clanWarFedToday, type ClanStoresTone } from "../lib/clan-stores";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";

// Tone → the palette the rest of Clan Hall already uses for the same three
// meanings (calm / caution / alarm). Colour is never the only carrier: every
// readout also spells its state out in the sentence beneath the figures.
const RATION_TONE_COLOR: Record<ClanStoresTone, string | undefined> = {
    neutral: undefined,
    warn: "#fbbf24",
    danger: "#f87171",
};

// Clan Wars panel — embedded inside Clan Hall's "Wars" tab. The full
// challenge inbox + composer lives in the Shinobi Council Hall →
// Clan Battles tab; this panel is a lightweight summary + jump-link
// so clan-bound players know about an active war without leaving
// the Clan Hall. Reads the same KV-backed war record via
// /api/clan/war/list (10s CDN cache) so HP stays in sync.
// Drained verbatim from App.tsx (2026-06-18) — behaviour unchanged; ClanHall is
// the sole consumer.
export function ClanWarsPanel({ character, clanName, provisions, storesOpen = true, onOpenTreasury, setScreen }: { character: Character; clanName: string; provisions?: number | null; storesOpen?: boolean; onOpenTreasury?: () => void; setScreen: (s: Screen) => void }) {
    const [wars, setWars] = useState<CwWar[]>([]);
    const [loading, setLoading] = useState(true);
    const [showClanWarManual, setShowClanWarManual] = useState(false);
    // The fed/unfed verdict is scoped to a UTC day, so it has to be read
    // against a clock rather than frozen. It is stamped with the war list, so
    // it is re-read on the same 20s beat instead of ticking in render (which
    // would make the render impure).
    const [storesNow, setStoresNow] = useState(() => Date.now());

    const refresh = useCallback(async () => {
        const list = await cwListWars();
        setWars(list);
        setStoresNow(Date.now());
        setLoading(false);
    }, []);
    useEffect(() => {
        void refresh();
        const id = setInterval(refresh, 20_000);
        return () => clearInterval(id);
    }, [refresh]);

    const activeWar = wars.find(w => !w.endedAt && w.clans.includes(clanName));
    const enemyClan = activeWar?.clans.find(c => c !== clanName) ?? "";
    // Village Stores clan mirror: every active clan war burns its rations out
    // of clanTreasury.provisions once a day. Surfaced, never re-decided — the
    // server owns both the burn and the fed/unfed verdict.
    const ourActiveWars = wars.filter(w => !w.endedAt && w.clans.includes(clanName));
    const unfedWars = ourActiveWars.filter(w => clanWarFedToday(w, clanName, storesNow) === false).length;
    // The FED half of the same verdict. Counted separately rather than inferred
    // from `activeWars - unfedWars`, because a war the pass has not reached yet
    // today is neither — it is silence.
    const fedWars = ourActiveWars.filter(w => clanWarFedToday(w, clanName, storesNow) === true).length;
    const rations = storesOpen ? clanStoresReadout({ clanName, provisions, activeWars: ourActiveWars.length, unfedWars, fedWars }) : null;
    const recentEnded = wars
        .filter(w => w.endedAt && w.clans.includes(clanName))
        .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
        .slice(0, 3);

    return (
        <div className="summary-box">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0 }}>⚔️ Clan Wars</h3>
                <button
                    type="button"
                    onClick={() => setShowClanWarManual(v => !v)}
                    title="How does Clan War work?"
                    style={{ padding: "0.15rem 0.5rem", fontSize: "0.85rem", borderRadius: 999, border: "1px solid var(--blue-400)", background: "var(--slate-800)", color: "var(--blue-400)", cursor: "pointer", width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}
                >
                    ?
                </button>
            </div>
            <p className="hint">
                Clan wars are independent of Village Wars and run until one clan's HP hits 0.
                Send anonymous challenges in the <strong>Shinobi Council Hall → Clan Battles</strong> tab.
            </p>

            {showClanWarManual && <ClanWarManual onClose={() => setShowClanWarManual(false)} />}

            {loading && <p className="hint">Loading clan war state…</p>}

            {!loading && activeWar && (
                <div className="war-record-card" style={{ background: "#1f0a0a", borderColor: "var(--red-400)", marginTop: 10 }}>
                    <strong style={{ color: "var(--red-400)" }}>🚨 Active Clan War vs {enemyClan}</strong>
                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clanName}</span>
                                <span style={{ flexShrink: 0, marginLeft: 8 }}>{(activeWar.hp[clanName] ?? 0).toLocaleString()} / {(activeWar.hpMax?.[clanName] ?? CW_HP_MAX).toLocaleString()} HP</span>
                            </div>
                            <div className="bar" style={{ background: "#0b1220" }}>
                                <span style={{ width: `${Math.max(0, Math.min(100, ((activeWar.hp[clanName] ?? 0) / (activeWar.hpMax?.[clanName] ?? CW_HP_MAX)) * 100))}%`, background: "var(--success)" }} />
                            </div>
                        </div>
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{enemyClan}</span>
                                <span style={{ flexShrink: 0, marginLeft: 8 }}>{(activeWar.hp[enemyClan] ?? 0).toLocaleString()} / {(activeWar.hpMax?.[enemyClan] ?? CW_HP_MAX).toLocaleString()} HP</span>
                            </div>
                            <div className="bar enemy-bar" style={{ background: "#0b1220" }}>
                                <span style={{ width: `${Math.max(0, Math.min(100, ((activeWar.hp[enemyClan] ?? 0) / (activeWar.hpMax?.[enemyClan] ?? CW_HP_MAX)) * 100))}%`, background: "var(--danger)" }} />
                            </div>
                        </div>
                    </div>
                    <small style={{ display: "block", marginTop: 6, color: "var(--text-dim)" }}>
                        Started {new Date(activeWar.startedAt).toLocaleDateString()} · {activeWar.completedChallenges.length} battles completed · {activeWar.pendingChallenges.length} pending
                    </small>
                    <div className="menu" style={{ marginTop: 8 }}>
                        <button onClick={() => setScreen("shinobiCouncil")}>🏯 Open Clan Battles</button>
                    </div>
                </div>
            )}

            {!loading && !activeWar && (
                <div style={{ background: "#0b1220", border: "1px solid var(--slate-700)", borderRadius: 6, padding: "0.8rem", marginTop: 10 }}>
                    <p style={{ margin: 0 }}>{clanName} is not currently in a clan war.</p>
                    <p className="hint" style={{ marginTop: 6 }}>
                        Clan Founder, Leader, or Officer can declare war from the Shinobi Council Hall → Clan Battles tab.
                        Wars run until one clan's 1,000 HP hits 0. 7-day rematch cooldown.
                    </p>
                    <div className="menu" style={{ marginTop: 8 }}>
                        <button onClick={() => setScreen("shinobiCouncil")}>🏯 Open Clan Battles</button>
                    </div>
                </div>
            )}

            {!loading && rations && (
                <section className="summary-box" style={{ marginTop: 12 }}>
                    <h4 style={{ margin: "0 0 6px" }}>🍚 War Rations</h4>
                    <div className="treasury-grid">
                        <p><strong>Clan stores:</strong> {rations.held ?? "None stocked yet"}</p>
                        <p><strong>Daily war cost:</strong> {rations.burn}</p>
                        {rations.cover && <p><strong>Covers:</strong> {rations.cover}</p>}
                    </div>
                    <p className="hint" style={{ marginTop: 6, color: RATION_TONE_COLOR[rations.tone] }}>{rations.line}</p>
                    {onOpenTreasury && <div className="menu" style={{ marginTop: 6 }}>
                        <button type="button" onClick={onOpenTreasury}>🍚 Open the Treasury tab</button>
                    </div>}
                </section>
            )}

            {!loading && recentEnded.length > 0 && (
                <div style={{ marginTop: 14 }}>
                    <h4 style={{ margin: "0 0 6px" }}>Recent Clan Wars</h4>
                    <div className="war-record-grid">
                        {recentEnded.map(w => {
                            const opponent = w.clans.find(c => c !== clanName) ?? "?";
                            const weWon = w.winnerClan === clanName;
                            const mvp = w.mvpByClan?.[clanName];
                            return (
                                <div key={w.id} className="war-record-card">
                                    <strong style={{ color: weWon ? "var(--green-400)" : "var(--red-400)" }}>{weWon ? "🏆 Victory" : "💀 Defeat"} vs {opponent}</strong>
                                    <small>HP: {clanName} {(w.hp[clanName] ?? 0).toLocaleString()} · {opponent} {(w.hp[opponent] ?? 0).toLocaleString()}</small>
                                    <small>Battles: {w.completedChallenges.length} · Ended {w.endedAt ? new Date(w.endedAt).toLocaleDateString() : "—"}</small>
                                    {mvp && <small>👑 MVP: {mvp}</small>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <p className="hint" style={{ marginTop: 14, fontSize: "0.78rem" }}>
                Tip: Clan wars deal HP damage by challenge type — Combat ({CW_DAMAGE.pvp1v1} / {CW_DAMAGE.pvp2v2}) &gt; Pet ({CW_DAMAGE.pet1v1} / {CW_DAMAGE.pet2v2}) &gt; Chronicle Showdown ({CW_DAMAGE.tilecards}). Drive the enemy clan to 0 HP to win.
            </p>
            <p className="hint" style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>You are playing as {character.name}.</p>
        </div>
    );
}
