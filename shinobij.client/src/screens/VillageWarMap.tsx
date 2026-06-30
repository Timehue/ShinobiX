/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback, useMemo } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { visiblePoll } from "../lib/poll";
import {
    fetchWarMap,
    declareSectorWar,
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
import { WAR_CREST, TERRAIN_IMAGES, STRUCTURE_IMAGES, WINCON_IMAGES } from "../data/war-ui-images";

// ─── Village War Map (Phase 6) ──────────────────────────────────────────────
// The "command surface" beside the existing VillageWarScreen (§10/§11b.6): each
// war village's WR/seal pools + structures + tax tier, every home sector's owner
// + win-condition + terrain + live Control-HP, and the Kage actions (declare a
// sector war, set win-conditions/terrain, upgrade structures). The on-map banner
// overlay and the battle-launch flows layer on separately. View data comes from
// /api/village/war-map + /api/world-state (ownership); all actions are server-auth.

interface TerritoryLite {
    sector: number;
    ownerVillage?: string;
}

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

    const myVillage = (character.village ?? "").trim();

    useEffect(() => {
        let alive = true;
        fetch("/api/game-state").then((r) => r.json()).then((d) => {
            if (!alive) return;
            const slug = myVillage.toLowerCase().replace(/[^a-z0-9]/g, "");
            const st = (d.villageStates ?? {})[slug] as { seatedKage?: string } | undefined;
            setIsKage((st?.seatedKage ?? "").toLowerCase() === character.name.toLowerCase());
        }).catch(() => {});
        return () => { alive = false; };
    }, [character.name, myVillage]);

    const refresh = useCallback(async () => {
        try {
            const wm = await fetchWarMap();
            const ws = await fetch("/api/world-state", { method: "GET" }).then((r) => r.json()).catch(() => ({}));
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
    // Combat sieges THIS village is running — where a merc can be deployed.
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
                                <span>Tax <b>{myView.taxRatePct}%</b></span>
                                <span>Upkeep <b>{myView.upkeepWr}</b> WR/day</span>
                                <span>+{myView.wrPerSector} WR/sector</span>
                            </div>
                            {isKage && (
                                <div className="vwm-structures">
                                    {WAR_STRUCTURES.map((s) => (
                                        <button
                                            key={s.key}
                                            disabled={!!busy}
                                            onClick={() => act(`up-${s.key}`, () => upgradeWarStructure(character.name, myVillage, s.key))}
                                            title="Upgrade with treasury Honor Seals"
                                        >
                                            {STRUCTURE_IMAGES[s.key] && <img src={STRUCTURE_IMAGES[s.key]} alt="" style={{ height: 18, width: 18, verticalAlign: "middle", marginRight: 4 }} />}{s.name} <b>L{myView.structures[s.key] ?? 0}</b> ⬆
                                        </button>
                                    ))}
                                </div>
                            )}
                            {!isKage && <p className="hint">Only the seated Kage can declare sector wars, set sector rules, and upgrade structures.</p>}
                        </div>
                    )}

                    {isKage && mercData && (
                        <div className="card vwm-mercs">
                            <h3>Mercenaries</h3>
                            <p className="hint">Hire a 2-day AI merc band, then deploy them at an enemy defender on a Combat sector you're besieging. Fights resolve server-side — a merc win chips Control HP, a loss gives the defender only 25% back.</p>
                            <div className="vwm-merc-tiers">
                                {mercData.tiers.map((t) => {
                                    const band = mercData.leases.find((l) => l.tierId === t.id);
                                    const portrait = mercPortrait(t.id);
                                    const sectorSel = deploySector[t.id] ?? myCombatContests[0]?.sector ?? 0;
                                    return (
                                        <div key={t.id} className="vwm-merc-tier">
                                            {portrait && <img className="vwm-merc-portrait" src={portrait} alt={t.id} />}
                                            <div className="vwm-merc-name">{t.id} · L{t.level}</div>
                                            <button disabled={!!busy} onClick={() => act(`hire-${t.id}`, async () => { await hireMerc(character.name, myVillage, t.id); await loadMercs(); })}>
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
                                                            const r = (await deployMerc(character.name, myVillage, t.id, sectorSel, (deployTarget[t.id] ?? "").trim())) as { winner?: string; captured?: boolean; controlHp?: number; mercsRemaining?: number };
                                                            setMercMsg(r.captured ? `⚑ Captured sector ${sectorSel}!` : `Sector ${sectorSel}: ${r.winner ?? "?"} won — Control HP ${r.controlHp ?? "?"}, ${r.mercsRemaining ?? 0} merc(s) left.`);
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
                            {myCombatContests.length === 0 && <p className="hint">Declare a Combat sector war first, then deploy mercs at its defenders.</p>}
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
                                    const canDeclare = isKage && owner !== myVillage && !contest;
                                    const pct = contest ? Math.round((contest.controlHp / Math.max(1, contest.controlHpMax)) * 100) : 100;
                                    return (
                                        <div key={sec.sector} className="vwm-sector" style={{ borderColor: villageAccent(owner) }}>
                                            <div className="vwm-sector-head">
                                                <b>{sec.alias ?? `#${sec.sector}`}</b>
                                                <span style={{ color: villageAccent(owner) }}>{owner === myVillage ? "yours" : owner}</span>
                                            </div>
                                            <div className="vwm-sector-meta">{WINCON_IMAGES[sec.winCondition] && <img src={WINCON_IMAGES[sec.winCondition]} alt="" style={{ height: 16, width: 16, verticalAlign: "middle", marginRight: 3, borderRadius: 3 }} />}{sec.winCondition} · {TERRAIN_IMAGES[sec.terrain] && <img src={TERRAIN_IMAGES[sec.terrain]} alt="" style={{ height: 16, width: 16, verticalAlign: "middle", margin: "0 3px", borderRadius: 3 }} />}{sec.terrain}</div>
                                            {contest && (
                                                <div className="vwm-control" title={`${contest.attackerVillage} besieging`}>
                                                    <div className="vwm-bar"><span style={{ width: `${pct}%`, background: villageAccent(contest.defenderVillage) }} /></div>
                                                    <small>{contest.controlHp}/{contest.controlHpMax}</small>
                                                </div>
                                            )}
                                            {canDeclare && (
                                                <button className="vwm-declare" disabled={!!busy} onClick={() => act(`dec-${sec.sector}`, () => declareSectorWar(character.name, myVillage, sec.sector))}>
                                                    Declare War
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
                            <h4>Active Sieges</h4>
                            {data.contests.map((c) => (
                                <div key={c.id} className="vwm-contest-row">
                                    <span style={{ color: villageAccent(c.attackerVillage) }}>{c.attackerVillage}</span>
                                    <span> → sector {c.sector} → </span>
                                    <span style={{ color: villageAccent(c.defenderVillage) }}>{c.defenderVillage}</span>
                                    <span className="vwm-contest-meta"> · {c.winCondition} · {c.controlHp}/{c.controlHpMax} HP</span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
