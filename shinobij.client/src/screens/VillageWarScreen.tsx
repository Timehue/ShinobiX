/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
import { useState, useEffect, useCallback } from "react";
// Fantasy chrome glyphs (game-icons.net, CC BY 3.0 — attributed in the About guide).
import { GiCrossedSwords, GiScrollUnfurled, GiTrophy, GiEyeball, GiBlackFlag } from "react-icons/gi";
const VW_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
import { visiblePoll } from "../lib/poll";
import type { Character, PlayerRecord } from "../types/character";
import { TERRITORY_HP_MAX, LEGENDARY_WAR_CRATE_ID } from "../constants/game";
import { currentDateKey } from "../lib/utils";
import { VILLAGE_WAR_HP_MAX, type TerritoryRecord, type VillageWarRecord } from "../lib/world-state";
import { gameConfirm } from "../components/GameAlert";

// ─── Village War Screen ───────────────────────────────────────────────────────
// Lets a village member view the active war (if any), raid enemy sectors, and
// (if Kage / admin) declare a new war.
export function VillageWarScreen({
    character,
    updateCharacter,
    playerRoster,
    onBack,
}: {
    character: Character;
    updateCharacter: (c: Character) => void;
    playerRoster: PlayerRecord[];
    onBack: () => void;
}) {
    const [wars, setWars] = useState<VillageWarRecord[]>([]);
    const [territories, setTerritories] = useState<TerritoryRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [declaring, setDeclaring] = useState(false);
    const [declareTarget, setDeclareTarget] = useState("");
    const [isKage, setIsKage] = useState(false);
    // Tutorial popover — toggled by the ℹ button next to the page
    // header. Same UX pattern as the per-jutsu info popovers in PvP.
    const [showWarManual, setShowWarManual] = useState(false);

    useEffect(() => {
        let alive = true;
        fetch("/api/game-state").then(r => r.json()).then(data => {
            if (!alive) return;
            const myVillageNorm = (character.village ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const myState = (data.villageStates ?? {})[myVillageNorm] as { seatedKage?: string } | undefined;
            setIsKage((myState?.seatedKage ?? "").toLowerCase() === character.name.toLowerCase());
        }).catch(() => {});
        return () => { alive = false; };
    }, [character.name, character.village]);

    const refresh = useCallback(async () => {
        try {
            const r = await fetch("/api/world-state", { method: "GET" });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            setWars(Array.isArray(data.wars) ? data.wars : []);
            setTerritories(Array.isArray(data.territories) ? data.territories : []);
        } catch (e) {
            setError(String((e as Error).message || e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void refresh(); return visiblePoll(refresh, 15000); }, [refresh]);

    const myVillage = (character.village ?? "").trim();
    const activeWar = wars.find(w => !w.endedAt && Array.isArray(w.villages) && w.villages.includes(myVillage));
    const enemyVillage = activeWar?.villages?.find((v: string) => v !== myVillage) ?? "";
    const villages = Array.from(new Set(playerRoster.map(p => p.village).filter(Boolean))).filter(v => v !== myVillage);

    async function declareWar() {
        if (!declareTarget) return;
        setDeclaring(true);
        try {
            const r = await fetch("/api/world-state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    kind: "war",
                    war: { villages: [myVillage, declareTarget], startedAt: Date.now() },
                }),
            });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                throw new Error(data.error ?? `HTTP ${r.status}`);
            }
            await refresh();
        } catch (e) {
            setError(String((e as Error).message || e));
        } finally {
            setDeclaring(false);
        }
    }

    async function raidSector(sector: number) {
        if (!activeWar) return;
        const territory = territories.find(t => t.sector === sector);
        const newHp = Math.max(0, (territory?.hp ?? 20000) - 500);
        try {
            const r = await fetch("/api/world-state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    kind: "territory",
                    territory: {
                        ...territory,
                        sector,
                        hp: newHp,
                        ownerVillage: territory?.ownerVillage ?? enemyVillage,
                        warSupply: (territory?.warSupply ?? 0) + 50,
                    },
                }),
            });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                throw new Error(data.error ?? `HTTP ${r.status}`);
            }
            // A: war-ground bounty — +500 ryo + 1 Fate Shard, once per day,
            // for raiding the war-ground sector specifically. Applies whether
            // you reduce the sector's HP all the way to 0 or just chip it.
            const today = currentDateKey();
            const isWarGround = sector === activeWar.warGroundSector;
            const bountyEligible = isWarGround && character.warGroundBountyDate !== today;
            updateCharacter({
                ...character,
                totalVillageRaids: (character.totalVillageRaids ?? 0) + 1,
                villageWarRaidProgress: (character.villageWarRaidProgress ?? 0) + 1,
                ryo: (character.ryo ?? 0) + (bountyEligible ? 500 : 0),
                fateShards: (character.fateShards ?? 0) + (bountyEligible ? 1 : 0),
                warGroundBountyDate: bountyEligible ? today : character.warGroundBountyDate,
            });
            await refresh();
            // B (tug of war): capturing the war ground no longer ends the
            // war. Instead it flips ownership (capturedBy), refreshes the
            // sector territory HP, drains the enemy's village HP, and
            // resets warGroundHp so the OTHER side can push back. The war
            // itself only ends via enemy village HP reaching 0 (or Kage
            // peace / decay timeout).
            if (newHp === 0 && isWarGround) {
                const refreshedTerritory = {
                    ...territory,
                    sector,
                    hp: TERRITORY_HP_MAX,             // reset sector HP for the next push
                    ownerVillage: myVillage,          // flip ownership
                    warSupply: 0,                     // captured supply is consumed
                };
                await fetch("/api/world-state", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ kind: "territory", territory: refreshedTerritory }),
                });
                // Capture event on the war record. Pass capturedBy + reset
                // warGroundHp + apply the +750 capture damage to enemy HP.
                // Server's HP delta cap permits a 100-HP swing per write,
                // so we do two writes: one for the ownership flip + HP
                // reset, then a separate damage write.
                const enemyHpNow = activeWar.hp?.[enemyVillage] ?? VILLAGE_WAR_HP_MAX;
                const enemyHpAfterCapture = Math.max(0, enemyHpNow - 100); // capped per server rule
                const capturedAt = Date.now();
                await fetch("/api/world-state", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        kind: "war",
                        war: {
                            ...activeWar,
                            capturedBy: myVillage,
                            capturedAt,
                            warGroundHp: 500, // tug-of-war: reset, not zero
                            hp: { ...activeWar.hp, [enemyVillage]: enemyHpAfterCapture },
                        },
                    }),
                });
                await refresh();
            }
        } catch (e) {
            setError(String((e as Error).message || e));
        }
    }

    if (loading) return <div className="card" style={{ padding: "1.4rem", maxWidth: 720, margin: "1rem auto" }}>Loading village war…</div>;

    // Wars my village won that I haven't claimed yet
    const claimable = wars.filter(w =>
        w.endedAt && w.winnerVillage === myVillage &&
        !(character.claimedWarCrateIds ?? []).includes(`war-crate-${w.id}`)
    );

    function claimVictory(war: VillageWarRecord) {
        // Canonical winner reward: 1× Legendary War Crate, dedup via
        // claimedWarCrateIds. Matches claimPendingWarCrates exactly so
        // whichever path the player triggers first delivers the same
        // payout — previously this button also gave +500 ryo + 250 XP
        // that the auto-sweep didn't, so first-touch silently locked
        // the other side out of the discrepancy.
        const crateId = `war-crate-${war.id}`;
        const claimed = character.claimedWarCrateIds ?? [];
        if (claimed.includes(crateId)) return;
        updateCharacter({
            ...character,
            inventory: [...character.inventory, LEGENDARY_WAR_CRATE_ID],
            claimedWarCrateIds: [...claimed, crateId],
        });
    }

    return (
        <div className="card" style={{ maxWidth: 820, margin: "1rem auto", padding: "1.4rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}>
                <h1 style={{ margin: 0 }}><GiCrossedSwords style={VW_ICON} />Village War</h1>
                <button
                    type="button"
                    onClick={() => setShowWarManual(v => !v)}
                    title="How does Village War work?"
                    style={{ padding: "0.2rem 0.55rem", fontSize: "0.85rem", borderRadius: 4, border: "1px solid #60a5fa", background: "#1e293b", color: "#60a5fa", cursor: "pointer" }}
                >
                    ℹ How it works
                </button>
            </div>
            {showWarManual && (
                <div style={{ background: "#0b1220", border: "1px solid #334155", borderRadius: 8, padding: "1rem", marginBottom: "1rem", fontSize: "0.88rem", lineHeight: 1.55 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong style={{ color: "#fde047", fontSize: "1rem" }}><GiScrollUnfurled style={VW_ICON} />Village War Manual</strong>
                        <button type="button" onClick={() => setShowWarManual(false)} style={{ padding: "0.15rem 0.5rem", background: "#7f1d1d", borderColor: "#ef4444", color: "#fca5a5", fontSize: "0.75rem" }}>✕ Close</button>
                    </div>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>Declaring war.</strong> Only your village's <em>seated Kage</em> can declare. Costs <strong>500 Honor Seals</strong> from the Kage's personal treasury. Same two villages have a <strong>7-day rematch cooldown</strong> after a war ends. Each village can only be in <strong>one war at a time</strong>.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>How damage works.</strong> Each village starts with <strong>5000 War HP</strong> + a shared <strong>1000-HP War Ground sector</strong>. Each PvP fight moves both villages' HP — the winner contributes damage from <em>their</em> position; the loser's village takes extra damage if <em>they</em> were a high-value target.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 0, border: "1px solid #334155", borderRadius: 6, overflow: "hidden", marginBottom: "0.6rem", fontSize: "0.82rem" }}>
                        <div style={{ background: "#1e293b", padding: "0.35rem 0.6rem", fontWeight: 700, color: "#fde047" }}>Position</div>
                        <div style={{ background: "#1e293b", padding: "0.35rem 0.6rem", fontWeight: 700, color: "#4ade80", textAlign: "right" }}>You win</div>
                        <div style={{ background: "#1e293b", padding: "0.35rem 0.6rem", fontWeight: 700, color: "#f87171", textAlign: "right" }}>You lose</div>
                        <div style={{ padding: "0.3rem 0.6rem" }}>Seated Kage</div>
                        <div style={{ padding: "0.3rem 0.6rem", textAlign: "right", color: "#4ade80" }}>+30 enemy HP</div>
                        <div style={{ padding: "0.3rem 0.6rem", textAlign: "right", color: "#f87171" }}>−50 your HP</div>
                        <div style={{ padding: "0.3rem 0.6rem", background: "#0f172a" }}>Village Elder · Clan Head / Elder / Founder</div>
                        <div style={{ padding: "0.3rem 0.6rem", background: "#0f172a", textAlign: "right", color: "#4ade80" }}>+20 enemy HP</div>
                        <div style={{ padding: "0.3rem 0.6rem", background: "#0f172a", textAlign: "right", color: "#f87171" }}>−20 your HP</div>
                        <div style={{ padding: "0.3rem 0.6rem" }}>ANBU</div>
                        <div style={{ padding: "0.3rem 0.6rem", textAlign: "right", color: "#4ade80" }}>+15 enemy HP</div>
                        <div style={{ padding: "0.3rem 0.6rem", textAlign: "right", color: "#64748b" }}>−0</div>
                        <div style={{ padding: "0.3rem 0.6rem", background: "#0f172a" }}>Regular villager</div>
                        <div style={{ padding: "0.3rem 0.6rem", background: "#0f172a", textAlign: "right", color: "#4ade80" }}>+5 enemy HP</div>
                        <div style={{ padding: "0.3rem 0.6rem", background: "#0f172a", textAlign: "right", color: "#64748b" }}>−0</div>
                    </div>
                    <p style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", color: "#94a3b8" }}>
                        Both columns stack on the same fight. Examples: a regular villager defeating a Kage = <strong style={{ color: "#4ade80" }}>+5 enemy HP</strong> (their win) AND <strong style={{ color: "#f87171" }}>−50 to the Kage's village</strong> (kill penalty) = <strong>55 total damage</strong>. Kage beats Elder = +30 +20 = 50. Regular vs regular = +5. PvP wins on the war-ground sector drain the sector AND the enemy village HP simultaneously.
                    </p>
                    <p style={{ margin: "0 0 0.5rem", fontSize: "0.78rem", color: "#fbbf24" }}>
                        ⚠ <strong>Clan-leadership gate:</strong> Clan Head / Clan Elder / Clan Founder only get the <strong>+20</strong> tier when their clan has <strong>at least 8 total members</strong> (you + 7 others). Smaller clans drop to the regular <strong>+5/−0</strong> tier. Village Elder seats and ANBU are unaffected.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>Home defender bonus.</strong> When you win a PvP fight in a sector your own village owns, you get <strong>+15%</strong> war HP credit. This only scales the war ledger — the actual fight is unchanged.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>The war ground (tug of war).</strong> The war-ground sector is a contestable objective — capture it from this screen by raiding it to 0 HP, or drain its war-HP via PvP wins inside it. Each capture flips ownership, deals an extra <strong>+750 enemy HP</strong>, and resets the war ground HP to 500 so the other side can push back. The war ground can change hands repeatedly during a war.</p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>War Ground Bounty.</strong> Every successful war-ground raid pays <strong>+500 ryo + 1 Fate Shard</strong>, once per UTC day per player. Independent of who wins the war — even losers get paid for showing up.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>Winning the war.</strong> A side wins when the <em>enemy village HP hits 0</em>. Capturing the war ground only deals bonus damage — it doesn't end the war alone. The Kage may also call peace (ends with no winner, no crate).
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>Decay.</strong> After 3 days, both sides lose <strong>500 war HP per UTC reset</strong> to push idle wars toward resolution. A war that nobody touches ends naturally around day 13.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>Rewards.</strong>
                        <br />• <strong>Every winning villager:</strong> 1× Legendary War Crate.
                        <br />• <strong>MVP each side</strong> (top damage on the leaderboard): +1 extra Legendary Crate, +10,000 ryo, +50 Honor Seals, +2 Fate Shards. Even the losing-side MVP earns this.
                        <br />• <strong>Losing villagers who contributed ≥50 damage:</strong> 5,000 ryo, 25 Honor Seals, 1 Fate Shard consolation. No reward on draws.
                    </p>
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.8rem" }}>
                        Rewards auto-claim on your next login or the next time you open this screen — no buttons to click for the standard crate.
                    </p>
                </div>
            )}
            {error && <div style={{ color: "#f87171", marginBottom: "0.5rem" }}>⚠ {error}</div>}
            {claimable.length > 0 && (
                <div style={{ background: "linear-gradient(#1a3a1a,#0a2010)", border: "1px solid #4ade80", borderRadius: 8, padding: "0.8rem", marginBottom: "1rem" }}>
                    <strong style={{ color: "#4ade80" }}><GiTrophy style={VW_ICON} />Victory rewards available</strong>
                    {claimable.map(w => (
                        <div key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                            <span>vs {w.villages.find(v => v !== myVillage) ?? "?"} — won {new Date(w.endedAt!).toLocaleDateString()}</span>
                            <button onClick={() => claimVictory(w)} style={{ padding: "0.3rem 0.7rem", background: "linear-gradient(#1a3a1a,#0a2010)", borderColor: "#4ade80", fontSize: "0.85rem" }}>
                                Claim Reward
                            </button>
                        </div>
                    ))}
                </div>
            )}
            {activeWar ? (
                <>
                    <div style={{ background: "#1a1a2e", border: "1px solid #f87171", borderRadius: 8, padding: "0.8rem", marginBottom: "1rem" }}>
                        <div style={{ fontWeight: 700, color: "#f87171", fontSize: "1.1rem" }}>{myVillage} vs {enemyVillage}</div>
                        <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Started {new Date(activeWar.startedAt).toLocaleDateString()}</div>
                        {activeWar.pendingUntil && activeWar.pendingUntil > Date.now() && (
                            <div style={{ marginTop: 8, padding: "0.5rem 0.7rem", background: "linear-gradient(#3b2a05, #1f1402)", border: "1px solid #fbbf24", borderRadius: 6 }}>
                                <strong style={{ color: "#fde047" }}>⏳ War starts in {Math.max(1, Math.ceil((activeWar.pendingUntil - Date.now()) / 60_000))} min</strong>
                                <p style={{ fontSize: "0.78rem", color: "#fcd34d", margin: "4px 0 0" }}>
                                    Pre-war window. No HP can drop, no PvP raid will count yet. Use this time to rally your village, queue guards, and gather pre-fight buffs.
                                </p>
                            </div>
                        )}
                        <div style={{ marginTop: 8 }}>
                            <div>My village HP: <strong style={{ color: "#4ade80" }}>{activeWar.hp?.[myVillage] ?? 0}</strong></div>
                            <div>Enemy HP: <strong style={{ color: "#f87171" }}>{activeWar.hp?.[enemyVillage] ?? 0}</strong></div>
                            <div>War Ground (sector {activeWar.warGroundSector}): {activeWar.warGroundHp}</div>
                        </div>
                    </div>
                    {/* Per-village live contribution leaderboard. Server
                        accumulates damage on every raid/PvP write; we
                        show top-3 on each side so MVP is visible at a
                        glance. Read-only — no editable state. */}
                    {(() => {
                        const contribs = Object.values(activeWar.contributions ?? {});
                        if (contribs.length === 0) return null;
                        const mySide = contribs.filter(c => c.side === myVillage).sort((a, b) => b.damage - a.damage).slice(0, 3);
                        const enemySide = contribs.filter(c => c.side === enemyVillage).sort((a, b) => b.damage - a.damage).slice(0, 3);
                        return (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: "1rem" }}>
                                <div style={{ background: "#0a1f0a", border: "1px solid #4ade80", borderRadius: 6, padding: "0.6rem" }}>
                                    <strong style={{ color: "#4ade80" }}><GiTrophy style={VW_ICON} />{myVillage} Top Raiders</strong>
                                    {mySide.length === 0
                                        ? <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "0.4rem 0 0" }}>No raids yet. Be the first.</p>
                                        : mySide.map((c, i) => (
                                            <div key={c.name} style={{ fontSize: "0.85rem", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                                                <span>{i + 1}. <strong>{c.name}</strong></span>
                                                <span style={{ color: "#fde047" }}>{c.damage} dmg · {c.raids} raids</span>
                                            </div>
                                        ))}
                                </div>
                                <div style={{ background: "#1f0a0a", border: "1px solid #f87171", borderRadius: 6, padding: "0.6rem" }}>
                                    <strong style={{ color: "#f87171" }}><GiCrossedSwords style={VW_ICON} />{enemyVillage} Top Raiders</strong>
                                    {enemySide.length === 0
                                        ? <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "0.4rem 0 0" }}>Enemy hasn't raided yet.</p>
                                        : enemySide.map((c, i) => (
                                            <div key={c.name} style={{ fontSize: "0.85rem", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                                                <span>{i + 1}. <strong>{c.name}</strong></span>
                                                <span style={{ color: "#fde047" }}>{c.damage} dmg · {c.raids} raids</span>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        );
                    })()}
                    <h3>Enemy Sectors — Raid to drain control</h3>
                    <p style={{ color: "#facc15", fontSize: "0.85rem", marginTop: -4 }}>
                        <GiBlackFlag style={VW_ICON} />Raiding the<strong>war-ground sector ({activeWar.warGroundSector})</strong> flips capture + drains enemy HP +500 ryo +1 Fate Shard daily bounty. The war ends when the enemy village HP hits 0.
                    </p>
                    <div style={{ display: "grid", gap: 6, maxHeight: 360, overflowY: "auto" }}>
                        {territories
                            .filter(t => (t.ownerVillage ?? "") === enemyVillage)
                            .map(t => (
                                <div key={t.sector} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.6rem", background: "#0a0a1a", borderRadius: 6 }}>
                                    <span>Sector {t.sector} — HP {t.hp}/20000 — Supply {t.warSupply}</span>
                                    <button
                                        onClick={() => raidSector(t.sector)}
                                        disabled={t.hp <= 0}
                                        style={{ padding: "0.3rem 0.7rem", background: t.hp > 0 ? "linear-gradient(#7f1d1d,#450a0a)" : "#333", borderColor: "#f87171", fontSize: "0.85rem" }}
                                    >
                                        {t.hp > 0 ? <><GiCrossedSwords style={VW_ICON} />Raid (-500 HP)</> : "Captured"}
                                    </button>
                                </div>
                            ))}
                        {territories.filter(t => (t.ownerVillage ?? "") === enemyVillage).length === 0 && (
                            <em style={{ color: "#64748b" }}>No enemy-controlled sectors found.</em>
                        )}
                    </div>
                </>
            ) : (
                <>
                    <p style={{ color: "#94a3b8" }}>No active war involving <strong>{myVillage || "your village"}</strong>.</p>
                    {isKage ? (
                        <div style={{ marginTop: "1rem", padding: "0.8rem", background: "#0a0a1a", borderRadius: 8 }}>
                            <h3 style={{ marginTop: 0 }}>Declare War (Kage)</h3>
                            <p style={{ fontSize: "0.8rem", color: "#fbbf24", marginTop: 0, marginBottom: "0.5rem" }}>
                                Cost: <strong>500 Honor Seals</strong> · Rematch cooldown: 7 days · One war per village at a time
                            </p>
                            <select value={declareTarget} onChange={e => setDeclareTarget(e.target.value)} style={{ padding: "0.4rem", marginRight: "0.5rem" }}>
                                <option value="">Select target village…</option>
                                {villages.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                            <button
                                disabled={!declareTarget || declaring || (character.honorSeals ?? 0) < 500}
                                onClick={async () => {
                                    if (!(await gameConfirm(`Declare war on ${declareTarget}? This will cost 500 Honor Seals from your treasury.`))) return;
                                    void declareWar();
                                }}
                                style={{ padding: "0.5rem 1rem", background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171" }}
                                title={(character.honorSeals ?? 0) < 500 ? "Need 500 Honor Seals" : undefined}
                            >
                                {declaring ? "Declaring…" : (character.honorSeals ?? 0) < 500 ? `⚔ Declare War (need 500 Seals — have ${(character.honorSeals ?? 0)})` : "⚔ Declare War — 500 Honor Seals"}
                            </button>
                        </div>
                    ) : (
                        <p style={{ color: "#64748b", fontStyle: "italic" }}>Only the Kage of your village can declare war.</p>
                    )}
                </>
            )}
            {/* Spectator section — any other active wars in the world.
                Read-only HP bars + top-3 raiders per side so players
                can keep an eye on cross-village politics even when
                their own village isn't fighting. */}
            {(() => {
                const otherWars = wars.filter(w =>
                    !w.endedAt
                    && Array.isArray(w.villages)
                    && (!myVillage || !w.villages.includes(myVillage))
                );
                if (otherWars.length === 0) return null;
                return (
                    <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid #334155" }}>
                        <h3 style={{ marginTop: 0, marginBottom: "0.5rem", color: "#94a3b8" }}><GiEyeball style={VW_ICON} />Other Active Wars</h3>
                        <p style={{ fontSize: "0.78rem", color: "#64748b", marginTop: 0, marginBottom: "0.7rem" }}>
                            Wars not involving your village. Spectate only.
                        </p>
                        <div style={{ display: "grid", gap: 10 }}>
                            {otherWars.map(w => {
                                const [vA, vB] = w.villages;
                                const hpA = w.hp?.[vA] ?? 0;
                                const hpB = w.hp?.[vB] ?? 0;
                                const contribs = Object.values(w.contributions ?? {});
                                const topA = contribs.filter(c => c.side === vA).sort((a, b) => b.damage - a.damage)[0];
                                const topB = contribs.filter(c => c.side === vB).sort((a, b) => b.damage - a.damage)[0];
                                const ageDays = Math.floor((Date.now() - w.startedAt) / (24 * 60 * 60 * 1000));
                                return (
                                    <div key={w.id} style={{ background: "#0b1220", border: "1px solid #334155", borderRadius: 6, padding: "0.65rem" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                            <strong>{vA} <span style={{ color: "#64748b" }}>vs</span> {vB}</strong>
                                            <small style={{ color: "#64748b" }}>Day {ageDays + 1}</small>
                                        </div>
                                        <div style={{ display: "flex", gap: 12, fontSize: "0.82rem", marginTop: 4 }}>
                                            <span style={{ color: "#4ade80" }}>{vA}: <strong>{hpA}</strong></span>
                                            <span style={{ color: "#f87171" }}>{vB}: <strong>{hpB}</strong></span>
                                            <span style={{ color: "#94a3b8" }}>War Ground: {w.warGroundHp}/1000</span>
                                        </div>
                                        {(topA || topB) && (
                                            <div style={{ display: "flex", gap: 16, fontSize: "0.78rem", marginTop: 4, color: "#94a3b8" }}>
                                                {topA && <span><GiTrophy style={VW_ICON} />{vA}:<strong>{topA.name}</strong> ({topA.damage} dmg)</span>}
                                                {topB && <span><GiTrophy style={VW_ICON} />{vB}:<strong>{topB.name}</strong> ({topB.damage} dmg)</span>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}
            <button className="back-btn" style={{ marginTop: "1rem" }} onClick={onBack}>× Back</button>
        </div>
    );
}
