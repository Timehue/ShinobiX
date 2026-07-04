/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity -- idiomatic
   fetch-on-mount; Date.now() drives a display-only "days left" countdown. */
/*
 * Weekly Clan Boss tab. Shows the week's boss, the clan's shared HP pool, the
 * caller's attempts, and the live cross-clan standings; an assault queues a party
 * of up to 3 clanmates into a real Battle-Towers co-op fight (BattleTowerFight,
 * reused) whose server-computed damage banks into the pool. All authority is
 * server-side (api/clan-boss/*). Gated behind clanBoss.v1.
 */
import { useCallback, useEffect, useState } from "react";
import type { Character, BattleHistoryEntry } from "../types/character";
import { fetchMyRun, type TowerHostLoadout, type TowerSession } from "../lib/towers-api";
import { visiblePoll } from "../lib/poll";
import { fetchClanBoss, settleClanBossAssault, startClanBossAssault, type ClanBossView } from "../lib/clan-boss-api";
import { BattleTowerFight } from "./BattleTowerFight";
import oniPortrait from "../assets/clan-boss/clan-boss-oni.webp";
import leviathanPortrait from "../assets/clan-boss/clan-boss-leviathan.webp";
import kagePortrait from "../assets/clan-boss/clan-boss-kage.webp";
import golemPortrait from "../assets/clan-boss/clan-boss-golem.webp";

// Generated boss portraits (gpt-image-1), keyed by CLAN_BOSSES id.
const BOSS_PORTRAITS: Record<string, string> = {
    "oni-warlord": oniPortrait,
    "abyss-leviathan": leviathanPortrait,
    "fallen-kage": kagePortrait,
    "stone-golem": golemPortrait,
};

export function ClanBoss({ character, clanmates, hostLoadout, sharedImages, onRecordBattle }: {
    character: Character;
    clanmates: string[];
    hostLoadout?: TowerHostLoadout;
    sharedImages?: Record<string, string>;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
}) {
    const [view, setView] = useState<ClanBossView | null>(null);
    const [fight, setFight] = useState<{ runId: string; session: TowerSession } | null>(null);
    const [pendingRun, setPendingRun] = useState<{ runId: string; session: TowerSession } | null>(null);
    const [party, setParty] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [flash, setFlash] = useState("");

    const load = useCallback(async () => { setView(await fetchClanBoss(character.name)); }, [character.name]);
    useEffect(() => { void load(); }, [load]);

    // Co-op queue: poll for an assault a clanmate has invited us into (clan-boss runs
    // use the `cboss-` runId prefix) so we can JOIN and play our own turns. Offline
    // invitees still fight — their sealed fighter auto-acts via the AFK auto-pass.
    useEffect(() => {
        if (fight) return;
        let alive = true;
        const check = () => fetchMyRun(character.name)
            .then(r => { if (alive) setPendingRun(r && r.runId.startsWith("cboss-") ? r : null); })
            .catch(() => {});
        check();
        const stop = visiblePoll(check, 4000);
        return () => { alive = false; stop(); };
    }, [character.name, fight]);

    async function assault() {
        if (busy) return;
        setBusy(true);
        try {
            const res = await startClanBossAssault(character.name, party.slice(0, 2), hostLoadout);
            if ("error" in res) { setFlash(res.error); return; }
            setFight({ runId: res.runId, session: res.session });
        } finally { setBusy(false); }
    }

    // The fight reuses the tower screen; on exit, return to the tab and refetch.
    if (fight) {
        return (
            <BattleTowerFight
                character={character}
                sharedImages={sharedImages}
                hostLoadout={hostLoadout}
                runId={fight.runId}
                initialSession={fight.session}
                onRecordBattle={onRecordBattle}
                settleFn={settleClanBossAssault}
                settleOnAnyDone
                onExit={() => { setFight(null); setParty([]); setFlash("⚔ Assault resolved — your clan's boss pool has been updated below."); void load(); }}
            />
        );
    }

    if (!view) return <div className="summary-box"><p className="hint">Scouting the clan boss…</p></div>;
    if (!view.active) return <div className="summary-box"><h3>Weekly Clan Boss</h3><p className="hint">No clan boss is active right now. A fresh boss appears at the start of each week.</p></div>;
    if (!view.inClan || !view.myClan) return <div className="summary-box"><h3>Weekly Clan Boss</h3><p className="hint">Join a clan to take on the weekly boss with a party of 3.</p></div>;

    const mc = view.myClan;
    const boss = view.boss;
    const portrait = boss ? BOSS_PORTRAITS[boss.id] : undefined;
    const hpPct = Math.max(0, Math.min(100, (mc.pool / mc.poolMax) * 100));
    const dead = mc.killed;
    const daysLeft = view.endsAt ? Math.max(0, Math.ceil((view.endsAt - Date.now()) / 86400000)) : 0;

    return (
        <div className="summary-box clan-raid">
            <div className="clan-raid-boss">
                {portrait
                    ? <img className="clan-boss-portrait" src={portrait} alt={boss?.name ?? "Clan boss"} />
                    : <span className="clan-raid-boss-icon">{boss?.icon ?? "👹"}</span>}
                <div>
                    <h3 style={{ margin: 0 }}>{boss?.name ?? "Weekly Clan Boss"}</h3>
                    <p className="hint" style={{ margin: "3px 0 0" }}>{boss?.flavor}</p>
                    <p className="hint" style={{ margin: "3px 0 0", fontSize: "0.74rem" }}>Week ends in ~{daysLeft} day{daysLeft === 1 ? "" : "s"} · your clan is ranked {mc.rank ?? "—"}</p>
                </div>
            </div>

            <div className="clan-raid-hp">
                <div className="bar enemy-bar" style={{ background: "#0b1220" }}>
                    <span style={{ width: `${hpPct}%`, background: dead ? "#64748b" : "#ef4444" }} />
                </div>
                <div className="clan-raid-hp-label"><span>{dead ? "☠ Boss defeated" : "Boss HP (your clan)"}</span><span>{mc.pool.toLocaleString()} / {mc.poolMax.toLocaleString()}</span></div>
            </div>

            {flash && <p className="clan-raid-flash">{flash}</p>}

            {pendingRun && (
                <button
                    onClick={() => { const p = pendingRun; setPendingRun(null); setFight(p); }}
                    style={{ marginTop: 8, width: "100%", padding: "0.7rem", borderRadius: 8, background: "linear-gradient(#7f1d1d,#450a0a)", border: "1px solid #f87171", color: "#fecaca", fontWeight: 700, cursor: "pointer" }}
                >
                    ⚔ A clanmate is assaulting the boss — Join the fight!
                </button>
            )}

            <div className="menu" style={{ marginTop: 8 }}>
                {!dead && (
                    <button onClick={() => void assault()} disabled={busy || mc.myAttemptsLeft <= 0}>
                        {busy ? "Starting…" : mc.myAttemptsLeft > 0 ? `⚔ Assault the boss (${mc.myAttemptsLeft} left)` : "No assaults left this week"}
                    </button>
                )}
                {dead && <span className="hint" style={{ color: "#4ade80", fontWeight: 600 }}>✓ Your clan defeated the boss! Final standings lock at week's end.</span>}
            </div>

            {!dead && clanmates.length > 0 && (
                <div style={{ marginTop: 10 }}>
                    <p className="hint" style={{ fontSize: "0.78rem" }}>Bring up to 2 clanmates as your party (offline members auto-act during the fight):</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {clanmates.slice(0, 16).map(name => {
                            const on = party.includes(name);
                            return (
                                <button
                                    key={name}
                                    onClick={() => setParty(p => on ? p.filter(n => n !== name) : (p.length >= 2 ? p : [...p, name]))}
                                    style={{
                                        padding: "3px 9px", fontSize: "0.78rem", borderRadius: 999,
                                        border: `1px solid ${on ? "#f5c451" : "#334155"}`,
                                        background: on ? "rgba(245,196,81,0.15)" : "#0f172a",
                                        color: on ? "#f5c451" : "#94a3b8", cursor: "pointer",
                                    }}
                                >
                                    {on ? "✓ " : ""}{name}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <p className="hint" style={{ marginTop: 10, fontSize: "0.78rem" }}>
                Your clan has chipped <strong>{mc.damageDealt.toLocaleString()}</strong> boss HP with <strong>{mc.participants}</strong> member{mc.participants === 1 ? "" : "s"} fighting. This boss is tough — most assaults chip its HP and end in a wipe; the killing blow only lands once it's worn low. Score blends the kill, total damage, how many members join in, and how fast (rounds + time) you slay it — the top 3 clans earn treasury rewards at week's end.
            </p>

            {view.lastWeek && (
                <p className="hint" style={{ marginTop: 10, fontSize: "0.78rem", color: "#f5c451" }}>
                    🏆 Last week your clan finished <strong>#{view.lastWeek.rank}</strong>{view.lastWeek.rank <= 3 ? " — top 3! Treasury reward earned." : view.lastWeek.killed ? " — boss slain, participation reward earned." : "."}
                </p>
            )}

            <h4 style={{ margin: "14px 0 6px" }}>Clan Standings</h4>
            {(!view.standings || view.standings.length === 0) ? (
                <p className="hint">No clan has struck yet — be the first on the board.</p>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {view.standings.map(s => {
                        const isMine = s.clanName === mc.clanName;
                        return (
                            <div key={s.clanName} className={`clan-member-row-v2${isMine ? " clan-member-me" : ""}`} style={{ padding: "6px 10px" }}>
                                <span className="clan-member-pos">#{s.rank}</span>
                                <div className="clan-member-info"><span className="clan-member-name">{s.clanName}{isMine ? " ⭐" : ""}{s.killed ? " ☠" : ""}</span></div>
                                <span className="clan-contrib-total">{s.score.toLocaleString()} pts</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
