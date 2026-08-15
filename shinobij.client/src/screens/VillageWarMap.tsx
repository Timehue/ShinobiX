/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback, useMemo } from "react";
import "../styles/village-war-map-skin.css";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { visiblePoll } from "../lib/poll";
import { useSharedNow } from "../lib/use-shared-now";
import { isProtectedHomeSector } from "../data/war-map-sectors";
import {
    fetchWarMap,
    declareSectorWar,
    abandonSectorWar,
    setSectorWinCondition,
    setSectorTerrain,
    upgradeWarStructure,
    hireMerc,
    listMercs,
    deployMerc,
    villageAccent,
    WAR_STRUCTURES,
    WAR_TERRAINS,
    type WarMapResponse,
    type SectorWarContest,
    type WinCondition,
    type WrMercTierView,
    type MercLeaseView,
} from "../lib/village-war-map";
import { mercPortrait } from "../lib/merc-ai";
import { mercTierName } from "../lib/merc-roam-client";
import { WAR_CREST, TERRAIN_IMAGES, STRUCTURE_IMAGES, WINCON_IMAGES } from "../data/war-ui-images";

// ─── Village War Map (Phase 6) ──────────────────────────────────────────────
// The "command surface" beside the existing VillageWarScreen (§10/§11b.6): each
// war village's WR/seal pools + structures + tax tier, every home sector's owner
// + win-condition + terrain + the live 72h war score, and the Kage actions (declare
// a sector war, set win-conditions/terrain, upgrade structures). The on-map banner
// overlay and the battle-launch flows layer on separately. View data comes from
// /api/village/war-map + /api/world-state (ownership); all actions are server-auth.

interface TerritoryLite {
    sector: number;
    ownerVillage?: string;
}

// Terrain → home-ground edge (the defender gets +10% when the sector's fight
// matches its terrain). Mirrors the server exactly: Combat = api/pvp/move.ts
// terrainMultiplier, Pet = pet-duel-sim.ts terrainPetMult. Central is neutral,
// and Card is always fought on random neutral locations (kept fair).
const TERRAIN_LEGEND: readonly { key: string; label: string; effect: string }[] = [
    { key: "forest", label: "Forest", effect: "Taijutsu · Earth pets" },
    { key: "snow", label: "Snow", effect: "Bukijutsu · Water pets" },
    { key: "volcano", label: "Volcano", effect: "Ninjutsu · Fire pets" },
    { key: "shadow", label: "Shadow", effect: "Genjutsu · Lightning pets" },
    { key: "central", label: "Central", effect: "Neutral — no edge" },
];

export function VillageWarMap({ character, onBack, setScreen }: { character: Character; onBack: () => void; setScreen: (s: Screen) => void }) {
    const [data, setData] = useState<WarMapResponse | null>(null);
    const [owners, setOwners] = useState<Record<number, string>>({});
    const [isKage, setIsKage] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [disabled, setDisabled] = useState(false);
    const [busy, setBusy] = useState("");
    const [mercData, setMercData] = useState<{ tiers: WrMercTierView[]; leases: MercLeaseView[] } | null>(null);
    const [deploySector, setDeploySector] = useState<Record<string, number>>({});
    const [deployTarget, setDeployTarget] = useState<Record<string, string>>({});
    const [mercMsg, setMercMsg] = useState("");
    const [showInfo, setShowInfo] = useState(false);

    const myVillage = (character.village ?? "").trim();
    // Shared ticking clock — reading it in render is pure (react-hooks/purity),
    // and the war countdowns tick in sync with every other timer in the app.
    const nowTick = useSharedNow();

    useEffect(() => {
        let alive = true;
        // Read the AUTHORITATIVE seated Kage (village:kage:) — the SAME source the
        // server declare / win-condition / structure endpoints check — so the Kage
        // controls only appear when the server will actually accept them (avoids the
        // "you're shown the tools but the server says you're not the Kage" mismatch).
        fetch(`/api/village/kage?village=${encodeURIComponent(myVillage)}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
            if (!alive) return;
            setIsKage(String((d as { seatedKage?: string }).seatedKage ?? "").toLowerCase() === character.name.toLowerCase());
        }).catch(() => {});
        return () => { alive = false; };
    }, [character.name, myVillage]);

    const refresh = useCallback(async () => {
        try {
            const [wm, ws] = await Promise.all([
                fetchWarMap(),
                fetch("/api/world-state", { method: "GET" }).then((r) => r.json()).catch(() => ({})),
            ]);
            setData(wm);
            const map: Record<number, string> = {};
            const terrs = (ws as { territories?: TerritoryLite[] }).territories;
            if (Array.isArray(terrs)) {
                for (const t of terrs) {
                    const o = String(t.ownerVillage ?? "").trim();
                    if (o) map[t.sector] = o;
                }
            }
            setOwners(map);
            setError("");
            setDisabled(false);
        } catch (e) {
            const msg = String((e as Error).message || e);
            if (/not found/i.test(msg)) setDisabled(true);
            else setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadMercs = useCallback(async () => {
        try {
            const m = (await listMercs(character.name, myVillage)) as { tiers?: WrMercTierView[]; leases?: MercLeaseView[] };
            setMercData({ tiers: m.tiers ?? [], leases: m.leases ?? [] });
        } catch { /* mercs are best-effort (feature gated off / not a war village) */ }
    }, [character.name, myVillage]);

    useEffect(() => { void refresh(); void loadMercs(); return visiblePoll(refresh, 15000); }, [refresh, loadMercs]);

    const myView = useMemo(() => data?.villages.find((v) => v.village === myVillage) ?? null, [data, myVillage]);
    const contestBySector = useMemo(() => {
        const m: Record<number, SectorWarContest> = {};
        for (const c of data?.contests ?? []) m[c.sector] = c;
        return m;
    }, [data]);
    // Combat wars THIS village is attacking — where a merc can be deployed.
    const myCombatContests = useMemo(
        () => (data?.contests ?? []).filter((c) => c.attackerVillage === myVillage && c.winCondition === "combat"),
        [data, myVillage],
    );

    const act = useCallback(async (label: string, fn: () => Promise<unknown>) => {
        setBusy(label);
        try {
            await fn();
            await refresh();
        } catch (e) {
            setError(String((e as Error).message || e));
        } finally {
            setBusy("");
        }
    }, [refresh]);

    // Card contests are fought on the interactive Sector War Card Battle screen —
    // stash the contest id and navigate; that screen auto-joins as attacker/defender.
    const launchCardBattle = useCallback((sectorWarId: string) => {
        try { sessionStorage.setItem("sectorWarCard.v1", JSON.stringify({ sectorWarId })); } catch { /* ignore */ }
        setScreen("sectorCard");
    }, [setScreen]);
    // Pet contests are fought on the Sector War Pet Battle screen — a server-resolved
    // deterministic duel, then a byte-identical client replay. Stash + navigate.
    const launchPetBattle = useCallback((sectorWarId: string) => {
        try { sessionStorage.setItem("sectorWarPet.v1", JSON.stringify({ sectorWarId })); } catch { /* ignore */ }
        setScreen("sectorPet");
    }, [setScreen]);

    return (
        <div className="vwm-screen">
            <div className="vwm-header">
                <h1><img src={WAR_CREST} alt="" style={{ height: 28, width: 28, verticalAlign: "middle", marginRight: 8, borderRadius: 6 }} />Sector War Map</h1>
                <button className="vwm-back" onClick={onBack}>← Back</button>
            </div>

            <div className="vwm-info">
                <button className="vwm-info-head" onClick={() => setShowInfo((s) => !s)} aria-expanded={showInfo}>
                    <span><img src={WAR_CREST} alt="" />How Sector War works</span>
                    <span className="vwm-info-chevron">{showInfo ? "▲ Hide" : "▼ Learn"}</span>
                </button>
                {showInfo && (
                    <div className="vwm-info-body">
                        <p>Villages fight over the world map, <b>one sector at a time</b>. The seated <b>Kage</b> declares war on an enemy-held sector and sets how it's fought — then the whole village has <b>72 hours</b> to win it.</p>
                        <div className="vwm-info-grid">
                            <div><b>⚔ Three ways to fight</b><span>Combat (a shinobi duel), Pet (a beast duel), or Card (a Chronicle Showdown). Every fight is server-decided — no faking a win.</span></div>
                            <div><b>🏆 Most points in 72h wins</b><span>Every win scores kill points for your side and the tally counts up. Highest score when the clock runs out takes the sector — <b>a tie means the defender holds</b>. Rank is the score: felling a Kage is worth far more than a villager.</span></div>
                            <div><b>🗺 Terrain edge</b><span>The Kage sets each sector's terrain; the defender gets +10% on their home ground (Combat &amp; Pet). Central is neutral.</span></div>
                            <div><b>🗡 Mercenaries</b><span>The Kage spends War Resources to hire a roaming AI band that hunts enemy players and scores points for the attack.</span></div>
                            <div><b>🏯 Structures</b><span>Ramparts &amp; Watchtower fortify <i>this</i> war (WR, reset at peace); Barracks / War Academy / Supply Depot / Treasury Vault are permanent (Honor Seals).</span></div>
                            <div><b>👑 Kage only</b><span>Only your village's seated Kage can declare wars, set rules, and spend the war chest. Anyone can fight in a sector that's already contested.</span></div>
                        </div>
                    </div>
                )}
            </div>

            <div className="card vwm-terrain-legend">
                <h4><img src={WAR_CREST} alt="" style={{ height: 18, width: 18, verticalAlign: "middle", marginRight: 6, borderRadius: 4 }} />Terrain — home-ground edge</h4>
                <div className="vwm-terrain-grid">
                    {TERRAIN_LEGEND.map((t) => (
                        <div key={t.key} className="vwm-terrain-cell">
                            {TERRAIN_IMAGES[t.key] && <img src={TERRAIN_IMAGES[t.key]} alt="" />}
                            <div className="vwm-terrain-text"><b>{t.label}</b><span>{t.effect}</span></div>
                        </div>
                    ))}
                </div>
                <p className="hint">The Kage sets each sector's terrain. When it matches the fight, the <b>defender</b> gets <b>+10%</b> — Combat boosts a jutsu type, Pet boosts an element. <b>Central</b> is neutral; <b>Card</b> is always fought on random neutral locations.</p>
            </div>

            {loading && <p className="hint">Loading the war map…</p>}
            {disabled && <p className="hint">Sector War is not active yet.</p>}
            {error && <p className="vwm-error">{error}</p>}

            {data && !disabled && (
                <>
                    {myView && (
                        <div className="card vwm-resources" style={{ borderColor: villageAccent(myVillage) }}>
                            <h3 style={{ color: villageAccent(myVillage) }}>{myVillage} — War Resources</h3>
                            <div className="vwm-stats">
                                <span>WR Pool <b>{myView.warResources}</b>/{myView.warResourcesCap}{myView.dormant && <em className="vwm-dormant"> · dormant</em>}</span>
                                <span>Treasury Seals <b>{myView.treasurySeals}</b></span>
                                <span>Sectors held <b>{myView.sectorsHeld}</b></span>
                                <span title={myView.kageSeated === false ? "No Kage is seated, so your village collects no tax." : "Only territory held beyond your village's eight home sectors creates an occupation tax."}>Tax <b>{myView.taxRatePct}%</b>{myView.kageSeated === false && <> (no Kage)</>}</span>
                                <span>Upkeep <b>{myView.upkeepWr}</b> WR/day</span>
                                <span>+{myView.wrPerSector} WR/sector</span>
                            </div>
                            {isKage && (
                                <>
                                    <div className="vwm-structures">
                                        {WAR_STRUCTURES.map((s) => {
                                            const perWar = s.key === "ramparts" || s.key === "watchtower";
                                            return (
                                                <button
                                                    key={s.key}
                                                    disabled={!!busy}
                                                    onClick={() => act(`up-${s.key}`, () => upgradeWarStructure(character.name, myVillage, s.key))}
                                                    title={perWar ? "Fortify for THIS war — costs War Resources from the pool, resets to 0 when the war ends" : "Permanent upgrade — costs treasury Honor Seals"}
                                                >
                                                    {STRUCTURE_IMAGES[s.key] && <img src={STRUCTURE_IMAGES[s.key]} alt="" style={{ height: 18, width: 18, verticalAlign: "middle", marginRight: 4 }} />}{s.name} <b>L{myView.structures[s.key] ?? 0}</b> {perWar ? "· WR" : "⬆"}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <p className="hint">⚔ <b>Ramparts</b> &amp; <b>Watchtower</b> are per-war: bought with <b>War Resources</b> and reset to 0 once you're at peace. The other four are permanent (treasury Honor Seals) and can also be raised in Town Hall → Upgrades.</p>
                                </>
                            )}
                            {!isKage && <p className="hint">Only the seated Kage can declare sector wars, set sector rules, and upgrade structures.</p>}
                        </div>
                    )}

                    {mercData && (
                        <div className="card vwm-mercs">
                            <h3>Mercenaries</h3>
                            {!isKage && <p className="hint" style={{ color: "#fbbf24" }}>👑 This is the merc roster your village can field — only your seated Kage can hire and deploy them.</p>}
                            <p className="hint">Hire a 2-day AI merc band, then deploy them at an enemy defender on a Combat sector you're attacking. Fights resolve server-side — a merc win scores full points for the attack, and a defender who repels one scores a quarter.</p>
                            <div className="vwm-merc-tiers">
                                {mercData.tiers.map((t) => {
                                    const band = mercData.leases.find((l) => l.tierId === t.id);
                                    const portrait = mercPortrait(t.id);
                                    const sectorSel = deploySector[t.id] ?? myCombatContests[0]?.sector ?? 0;
                                    return (
                                        <div key={t.id} className="vwm-merc-tier">
                                            {portrait && <img className="vwm-merc-portrait" src={portrait} alt={t.id} />}
                                            <div className="vwm-merc-name">{mercTierName(t.id)} · L{t.level}</div>
                                            <button disabled={!isKage || !!busy} title={isKage ? undefined : "Only the seated Kage can hire mercenaries"} onClick={() => act(`hire-${t.id}`, async () => { await hireMerc(character.name, myVillage, t.id); await loadMercs(); })}>
                                                Hire · {t.costWr} WR
                                            </button>
                                            {band && <div className="vwm-merc-band">{band.count} merc{band.count === 1 ? "" : "s"} ready</div>}
                                            {band && band.count > 0 && myCombatContests.length > 0 && (
                                                <div className="vwm-merc-deploy">
                                                    <select value={sectorSel} disabled={!!busy} onChange={(e) => setDeploySector((s) => ({ ...s, [t.id]: Number(e.target.value) }))}>
                                                        {myCombatContests.map((c) => <option key={c.sector} value={c.sector}>Sector {c.sector}</option>)}
                                                    </select>
                                                    <input placeholder="target player" value={deployTarget[t.id] ?? ""} disabled={!!busy} onChange={(e) => setDeployTarget((s) => ({ ...s, [t.id]: e.target.value }))} />
                                                    <button
                                                        disabled={!!busy || !(deployTarget[t.id] ?? "").trim() || !sectorSel}
                                                        onClick={() => act(`deploy-${t.id}`, async () => {
                                                            const r = (await deployMerc(character.name, myVillage, t.id, sectorSel, (deployTarget[t.id] ?? "").trim())) as { winner?: string; attackerPoints?: number; defenderPoints?: number; mercsRemaining?: number };
                                                            setMercMsg(`Sector ${sectorSel}: ${r.winner ?? "?"} won — war score ${r.attackerPoints ?? "?"} : ${r.defenderPoints ?? "?"}, ${r.mercsRemaining ?? 0} merc(s) left.`);
                                                            await loadMercs();
                                                        })}
                                                    >Deploy</button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {mercMsg && <p className="vwm-merc-msg">{mercMsg}</p>}
                            {isKage && myCombatContests.length === 0 && <p className="hint">Declare a Combat sector war first, then deploy mercs at its defenders.</p>}
                        </div>
                    )}

                    {(data.villages ?? []).map((v) => (
                        <div key={v.village} className="card vwm-village" style={{ borderLeft: `4px solid ${villageAccent(v.village)}` }}>
                            <h4 style={{ color: villageAccent(v.village) }}>{v.village}{v.village === myVillage ? " (yours)" : ""}</h4>
                            <div className="vwm-grid">
                                {v.sectors.map((sec) => {
                                    const owner = owners[sec.sector] || v.village;
                                    const contest = contestBySector[sec.sector];
                                    const mine = v.village === myVillage && isKage;
                                    const protectedCore = isProtectedHomeSector(sec.sector);
                                    const canDeclare = isKage && owner !== myVillage && !contest && (!protectedCore || v.village === myVillage);
                                    const totalPts = contest ? contest.attackerPoints + contest.defenderPoints : 0;
                                    const pct = contest ? (totalPts > 0 ? Math.round((contest.attackerPoints / totalPts) * 100) : 50) : 0;
                                    const hoursLeft = contest ? Math.max(0, Math.ceil((contest.endsAt - nowTick) / 3_600_000)) : 0;
                                    return (
                                        <div key={sec.sector} className="vwm-sector" style={{ borderColor: villageAccent(owner) }}>
                                            <div className="vwm-sector-head">
                                                <b>{sec.alias ?? `#${sec.sector}`}</b>
                                                <span style={{ color: villageAccent(owner) }}>{owner === myVillage ? "yours" : owner}</span>
                                            </div>
                                            <div className="vwm-sector-meta">{WINCON_IMAGES[sec.winCondition] && <img src={WINCON_IMAGES[sec.winCondition]} alt="" style={{ height: 16, width: 16, verticalAlign: "middle", marginRight: 3, borderRadius: 3 }} />}{sec.winCondition} · {TERRAIN_IMAGES[sec.terrain] && <img src={TERRAIN_IMAGES[sec.terrain]} alt="" style={{ height: 16, width: 16, verticalAlign: "middle", margin: "0 3px", borderRadius: 3 }} />}{sec.terrain}</div>
                                            {protectedCore && <small className="hint">🛡 Protected gate · home village may reclaim</small>}
                                            {contest && (
                                                <div className="vwm-control" title={`${contest.attackerVillage} attacking — most points when the clock runs out takes the sector (tie: defender holds)`}>
                                                    <div className="vwm-bar"><span style={{ width: `${pct}%`, background: villageAccent(contest.attackerVillage) }} /></div>
                                                    <small>⚔ {contest.attackerPoints} : {contest.defenderPoints} 🛡 · {hoursLeft}h left</small>
                                                </div>
                                            )}
                                            {canDeclare && (
                                                <button className="vwm-declare" disabled={!!busy} onClick={() => act(`dec-${sec.sector}`, () => declareSectorWar(character.name, myVillage, sec.sector))}>
                                                    Declare War
                                                </button>
                                            )}
                                            {contest && isKage && contest.attackerVillage === myVillage && (
                                                <button
                                                    className="vwm-declare"
                                                    disabled={!!busy}
                                                    title="Concede this war. The sector stays with the defender whatever the score, and the War Resources you spent declaring are not refunded."
                                                    onClick={() => act(`aband-${sec.sector}`, () => abandonSectorWar(character.name, sec.sector))}
                                                >
                                                    Concede War
                                                </button>
                                            )}
                                            {contest && contest.winCondition === "card" && (myVillage === contest.attackerVillage || myVillage === contest.defenderVillage) && (
                                                <button className="vwm-declare" disabled={!!busy} onClick={() => launchCardBattle(contest.id)}>⚔ Card Battle</button>
                                            )}
                                            {contest && contest.winCondition === "pet" && (myVillage === contest.attackerVillage || myVillage === contest.defenderVillage) && (
                                                <button className="vwm-declare" disabled={!!busy} onClick={() => launchPetBattle(contest.id)}>🐾 Pet Battle</button>
                                            )}
                                            {mine && (
                                                <div className="vwm-config">
                                                    <select
                                                        value={sec.winCondition}
                                                        disabled={!!busy}
                                                        onChange={(e) => act(`wc-${sec.sector}`, () => setSectorWinCondition(character.name, myVillage, sec.sector, e.target.value as WinCondition))}
                                                    >
                                                        <option value="combat">Combat</option>
                                                        <option value="card">Card</option>
                                                        <option value="pet">Pet</option>
                                                    </select>
                                                    <select
                                                        value={sec.terrain}
                                                        disabled={!!busy}
                                                        onChange={(e) => act(`tr-${sec.sector}`, () => setSectorTerrain(character.name, myVillage, sec.sector, e.target.value))}
                                                    >
                                                        {WAR_TERRAINS.map((t) => <option key={t} value={t}>{t}</option>)}
                                                    </select>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    {(data.contests ?? []).length > 0 && (
                        <div className="card vwm-contests">
                            <h4>Active Wars</h4>
                            {data.contests.map((c) => (
                                <div key={c.id} className="vwm-contest-row">
                                    <span style={{ color: villageAccent(c.attackerVillage) }}>{c.attackerVillage}</span>
                                    <span> → sector {c.sector} → </span>
                                    <span style={{ color: villageAccent(c.defenderVillage) }}>{c.defenderVillage}</span>
                                    <span className="vwm-contest-meta"> · {c.winCondition} · ⚔ {c.attackerPoints} : {c.defenderPoints} 🛡 · {Math.max(0, Math.ceil((c.endsAt - nowTick) / 3_600_000))}h left</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
