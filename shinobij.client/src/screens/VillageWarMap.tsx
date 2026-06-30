/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback, useMemo } from "react";
import type { Character } from "../types/character";
import { visiblePoll } from "../lib/poll";
import {
    fetchWarMap,
    declareSectorWar,
    setSectorWinCondition,
    setSectorTerrain,
    upgradeWarStructure,
    villageAccent,
    WAR_STRUCTURES,
    WAR_TERRAINS,
    type WarMapResponse,
    type SectorWarContest,
    type WinCondition,
} from "../lib/village-war-map";

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

export function VillageWarMap({ character, onBack }: { character: Character; onBack: () => void }) {
    const [data, setData] = useState<WarMapResponse | null>(null);
    const [owners, setOwners] = useState<Record<number, string>>({});
    const [isKage, setIsKage] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [disabled, setDisabled] = useState(false);
    const [busy, setBusy] = useState("");

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

    useEffect(() => { void refresh(); return visiblePoll(refresh, 15000); }, [refresh]);

    const myView = useMemo(() => data?.villages.find((v) => v.village === myVillage) ?? null, [data, myVillage]);
    const contestBySector = useMemo(() => {
        const m: Record<number, SectorWarContest> = {};
        for (const c of data?.contests ?? []) m[c.sector] = c;
        return m;
    }, [data]);

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

    return (
        <div className="vwm-screen">
            <div className="vwm-header">
                <h1>⚔ Sector War Map</h1>
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
                                            {s.name} <b>L{myView.structures[s.key] ?? 0}</b> ⬆
                                        </button>
                                    ))}
                                </div>
                            )}
                            {!isKage && <p className="hint">Only the seated Kage can declare sector wars, set sector rules, and upgrade structures.</p>}
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
                                            <div className="vwm-sector-meta">{sec.winCondition} · {sec.terrain}</div>
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
                                            {mine && (
                                                <div className="vwm-config">
                                                    <select
                                                        value={sec.winCondition}
                                                        disabled={!!busy}
                                                        onChange={(e) => act(`wc-${sec.sector}`, () => setSectorWinCondition(character.name, myVillage, sec.sector, e.target.value as WinCondition))}
                                                    >
                                                        <option value="combat">Combat</option>
                                                        <option value="card">Card</option>
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
