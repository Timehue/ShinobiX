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
    garrisonAssaultable,
    setGarrisonFeed,
    contestGarrisonFeed,
    contestVillageUnfed,
    WAR_STRUCTURES,
    WAR_TERRAINS,
    type WarMapResponse,
    type SectorWarContest,
    type WinCondition,
    type WrMercTierView,
    type MercLeaseView,
} from "../lib/village-war-map";
import { mercPortrait } from "../lib/merc-ai";
import { isVillageAnbu } from "../lib/world-state";
import { revealedIntelForSector } from "../lib/village-intel";
import { DEPOT_CONVERSION_POINTS_PER_WR, GARRISON_RATIONS_PER_DAY, expectedDeclareCost, intelTierLabel, structureMaterialsCost } from "../lib/village-stores";
import {
    GARRISON_POINTS_CAP,
    GARRISON_POINTS_CAP_FED,
    WAR_RATIONS_PER_DAY,
    NO_WAR_MAP_ERROR,
    busyLabel,
    declareEstimateNote,
    depotConversionNote,
    garrisonFedCapLine,
    garrisonFeedStatusLine,
    provisionsMeaningLine,
    structureUpgradeNotice,
    warMapErrorAfterAction,
    warMapErrorAfterRefresh,
    wrAffordability,
    type WarMapErrorState,
} from "../lib/village-war-map-ui";
import { mercTierName } from "../lib/merc-roam-client";
import { gameToast } from "../components/GameToast";
import { GameIcon } from "../components/icons/GameIcon";
import { GiBowlOfRice, GiHazardSign } from "../components/icons/LightweightGameIcons";
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

/** Key for the memoised per-card derivations. A sector card belongs to the
 *  village panel it is drawn in (the fallback owner is that village), so both
 *  parts are part of the identity. */
function sectorViewKey(village: string, sector: number): string {
    return `${village}#${sector}`;
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
    // An ACTION error is sticky: the 15s poll must never wipe a refusal the Kage
    // has not read yet. A LOAD error is not — a recovered poll clears it.
    const [error, setError] = useState<WarMapErrorState>(NO_WAR_MAP_ERROR);
    const [disabled, setDisabled] = useState(false);
    const [busy, setBusy] = useState("");
    const [mercData, setMercData] = useState<{ tiers: WrMercTierView[]; leases: MercLeaseView[] } | null>(null);
    const [deploySector, setDeploySector] = useState<Record<string, number>>({});
    const [deployTarget, setDeployTarget] = useState<Record<string, string>>({});
    const [mercMsg, setMercMsg] = useState("");
    const [showInfo, setShowInfo] = useState(false);
    // ANBU appointees may toggle the garrison feed (like the war systems); the
    // server re-checks against the village's appointee list. Derived, not frozen
    // at mount — an appointment made mid-session must light the controls up.
    const isAnbu = useMemo(() => isVillageAnbu(character), [character]);

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
            // A background poll clears a stale LOAD error but never an action
            // refusal — see warMapErrorAfterRefresh.
            setError((prev) => warMapErrorAfterRefresh(prev, ""));
            setDisabled(false);
        } catch (e) {
            const msg = String((e as Error).message || e);
            if (/not found/i.test(msg)) setDisabled(true);
            else setError((prev) => warMapErrorAfterRefresh(prev, msg));
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
    // Everything a sector card shows that does NOT depend on the clock, derived
    // ONCE per data/ownership change. The screen ticks at 1Hz for the war
    // countdowns, and the 32-card grid used to redo all of this per card per
    // tick: a linear intel lookup (revealedIntelForSector), the declare pricing
    // and affordability, and a freshly allocated garrison-feed object. Only
    // `hoursLeft` reads the tick now — everything here is tick-independent, so
    // the values are identical, just computed ~32× less often.
    const sectorViews = useMemo(() => new Map((data?.villages ?? []).flatMap((v) => v.sectors.map((sec) => {
        const owner = owners[sec.sector] || v.village;
        const contest = contestBySector[sec.sector];
        const totalPts = contest ? contest.attackerPoints + contest.defenderPoints : 0;
        // Village Stores — expected declare cost: the intel tier this village holds
        // on the sector discounts the base (INTEL_DECLARE_BASE_COST, the client
        // mirror of api/_war-economy.ts SECTOR_WAR_WR) and the comeback multiplier
        // stacks on top. The server re-derives the real charge.
        const intelTier = revealedIntelForSector(sec.sector)?.tier ?? "none";
        const declareCost = expectedDeclareCost(intelTier, myView?.sectorsHeld ?? 0);
        const participant = !!contest && (contest.attackerVillage === myVillage || contest.defenderVillage === myVillage);
        return [sectorViewKey(v.village, sec.sector), {
            owner,
            contest,
            mine: v.village === myVillage && isKage,
            protectedCore: isProtectedHomeSector(sec.sector),
            canDeclare: isKage && owner !== myVillage && !contest && (!isProtectedHomeSector(sec.sector) || v.village === myVillage),
            pct: contest ? (totalPts > 0 ? Math.round((contest.attackerPoints / totalPts) * 100) : 50) : 0,
            intelTier,
            // Affordability against the LIVE pool, matching the merc tiers: a Kage
            // who cannot pay reads "Need … WR", not a button that only fails after
            // the round-trip.
            declareAfford: wrAffordability(declareCost, myView?.warResources ?? 0, { verb: "Declare War", estimate: true }),
            participant,
            canFeed: participant && (isKage || isAnbu),
            // Only MY village's feed entry — the enemy's paid feed is never shown as ours.
            myFeed: contest ? contestGarrisonFeed(contest, myVillage) : { on: false, covered: false },
            villageUnfed: !!contest && contestVillageUnfed(contest, myVillage),
        }] as const;
    }))), [data, owners, myVillage, isKage, isAnbu, contestBySector, myView]);
    // Same for the Active Wars list under the grid.
    const unfedContestIds = useMemo(
        () => new Set((data?.contests ?? []).filter((c) => contestVillageUnfed(c, myVillage)).map((c) => c.id)),
        [data, myVillage],
    );

    const act = useCallback(async (label: string, fn: () => Promise<unknown>) => {
        setBusy(label);
        // Acting IS the acknowledgement of the previous refusal — that (and the
        // dismiss button) is the only thing that clears a sticky error.
        setError(NO_WAR_MAP_ERROR);
        try {
            await fn();
            await refresh();
        } catch (e) {
            // The endpoints hand back a humanised `message` beside the machine
            // `error` code, and WarMapRequestError prefers it — so a refusal
            // reads "The treasury is short — 800 Honor Seals needed.", never
            // "insufficient-seals".
            setError(warMapErrorAfterAction(String((e as Error).message || e)));
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
    // Combat's liveness fallback — assault the sector's ANBU garrison when no
    // live defender has fought in ~2h. Resolved server-side as a real Solo PvE
    // fight against the defending village's sealed ANBU; stash the sector and
    // navigate, mirroring the card/pet battle launches above.
    const launchGarrisonAssault = useCallback((sector: number) => {
        try { sessionStorage.setItem("sectorWarGarrison.v1", JSON.stringify({ sector })); } catch { /* ignore */ }
        setScreen("sectorGarrison");
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
                            <div><b><GiBowlOfRice aria-hidden="true" /> Fed or Unfed</b><span>Every war eats <b>{WAR_RATIONS_PER_DAY} rations a day</b> from the Town Hall Provisions. A war marked <b>Unfed</b> is one a side could not cover — an unfed defender loses half its Watchtower bonus. Paying <b>{GARRISON_RATIONS_PER_DAY} more rations a day</b> feeds that sector's garrison as well, raising what it can bank from {GARRISON_POINTS_CAP} points to {GARRISON_POINTS_CAP_FED}.</span></div>
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
            {error.text && (
                <p className="vwm-error" role="alert">
                    <span>{error.text}</span>
                    <button type="button" className="vwm-error-dismiss" onClick={() => setError(NO_WAR_MAP_ERROR)} aria-label="Dismiss this message">Dismiss</button>
                </p>
            )}

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
                                <span><GameIcon name="bag" size={14} style={{ verticalAlign: "-2px", marginRight: 4, opacity: 0.85 }} />Provisions <b>{(myView.provisions ?? 0).toLocaleString()}</b> rations</span>
                                <span><GameIcon name="crystal" size={14} style={{ verticalAlign: "-2px", marginRight: 4, opacity: 0.85 }} />Materials <b>{(myView.materialPoints ?? 0).toLocaleString()}</b>{depotConversionNote(myView.depotConversionCap, DEPOT_CONVERSION_POINTS_PER_WR) && <> ({depotConversionNote(myView.depotConversionCap, DEPOT_CONVERSION_POINTS_PER_WR)})</>}</span>
                            </div>
                            {/* The stores' meaning used to live only in title= attributes on
                                non-focusable spans — unreachable by touch and keyboard. It is
                                a visible line now. */}
                            <p className="hint vwm-stores-meaning">{provisionsMeaningLine(GARRISON_RATIONS_PER_DAY)} Materials build L6+ structures, and the Supply Depot turns {DEPOT_CONVERSION_POINTS_PER_WR} of them into 1 War Resource each day.</p>
                            {isKage && (
                                <>
                                    <div className="vwm-structures">
                                        {WAR_STRUCTURES.map((s) => {
                                            const perWar = s.key === "ramparts" || s.key === "watchtower";
                                            const level = myView.structures[s.key] ?? 0;
                                            // Village Stores: raising a PERMANENT structure to L6+ also
                                            // debits materials (400 / 700 / 1,100 / 1,600 / 2,400).
                                            const materialsNeed = perWar ? 0 : structureMaterialsCost(level + 1);
                                            const raising = busy === `up-${s.key}`;
                                            return (
                                                <button
                                                    key={s.key}
                                                    disabled={!!busy}
                                                    onClick={() => act(`up-${s.key}`, async () => {
                                                        const r = (await upgradeWarStructure(character.name, myVillage, s.key)) as { newLevel?: number; materialsSpent?: number; remainingMaterialPoints?: number };
                                                        gameToast(structureUpgradeNotice({
                                                            name: s.name,
                                                            reportedLevel: r.newLevel,
                                                            knownCurrentLevel: level,
                                                            materialsSpent: r.materialsSpent,
                                                            remainingMaterials: r.remainingMaterialPoints,
                                                        }));
                                                    })}
                                                    title={perWar ? "Fortify for THIS war — costs War Resources from the pool, resets to 0 when the war ends" : materialsNeed > 0 ? `Permanent upgrade — costs treasury Honor Seals plus ${materialsNeed.toLocaleString()} materials from the stores` : "Permanent upgrade — costs treasury Honor Seals"}
                                                >
                                                    {STRUCTURE_IMAGES[s.key] && <img src={STRUCTURE_IMAGES[s.key]} alt="" style={{ height: 18, width: 18, verticalAlign: "middle", marginRight: 4 }} />}{raising ? `Raising ${s.name}…` : <>{s.name} <b>L{level}</b> {perWar ? "· WR" : "⬆"}{materialsNeed > 0 && <small className="vwm-materials-need"> · {materialsNeed.toLocaleString()} materials</small>}</>}
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
                                    const hireCost = wrAffordability(t.costWr, myView?.warResources ?? 0, { verb: "Hire" });
                                    return (
                                        <div key={t.id} className="vwm-merc-tier">
                                            {portrait && <img className="vwm-merc-portrait" src={portrait} alt={t.id} />}
                                            <div className="vwm-merc-name">{mercTierName(t.id)} · L{t.level}</div>
                                            <button
                                                disabled={!isKage || !!busy || !hireCost.affordable}
                                                title={isKage ? (hireCost.affordable ? undefined : `Your war pool holds ${(myView?.warResources ?? 0).toLocaleString()} WR.`) : "Only the seated Kage can hire mercenaries"}
                                                onClick={() => act(`hire-${t.id}`, async () => { await hireMerc(character.name, myVillage, t.id); await loadMercs(); })}
                                            >
                                                {busyLabel(busy, `hire-${t.id}`, "Hiring…", hireCost.label)}
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
                                                    >{busyLabel(busy, `deploy-${t.id}`, "Deploying…", "Deploy")}</button>
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
                                    // Every tick-independent value is memoised in `sectorViews`;
                                    // only the countdown below reads the 1Hz clock.
                                    const view = sectorViews.get(sectorViewKey(v.village, sec.sector));
                                    if (!view) return null;
                                    const { owner, contest, mine, protectedCore, canDeclare, pct, intelTier, declareAfford, participant, canFeed, myFeed } = view;
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
                                                    <small className={`vwm-fed-chip${contest.fed === false ? " is-unfed" : ""}`}><GiBowlOfRice aria-hidden="true" /> {contest.fed === false ? "Unfed" : "Fed"}</small>
                                                    {view.villageUnfed && <small className="vwm-dormant"><GiHazardSign aria-hidden="true" /> {myVillage} marches hungry</small>}
                                                </div>
                                            )}
                                            {contest && participant && (
                                                <div className="vwm-garrison-feed">
                                                    {canFeed ? (
                                                        <button
                                                            className="vwm-feed-toggle"
                                                            aria-pressed={myFeed.on}
                                                            disabled={!!busy}
                                                            title={`Spend ${GARRISON_RATIONS_PER_DAY} rations a day from the Town Hall stores to keep the sector garrison fed — while covered it holds ${GARRISON_POINTS_CAP_FED} points instead of ${GARRISON_POINTS_CAP}. Kage / ANBU only.`}
                                                            onClick={() => act(`feed-${sec.sector}`, async () => {
                                                                const r = await setGarrisonFeed(character.name, contest.id, !myFeed.on);
                                                                gameToast(r.garrisonFed
                                                                    ? `${r.village ?? myVillage} is feeding the Sector ${sec.sector} garrison — ${GARRISON_RATIONS_PER_DAY} rations a day.`
                                                                    : `Sector ${sec.sector} garrison is no longer being fed by ${myVillage}.`);
                                                            })}
                                                        >
                                                            <GiBowlOfRice aria-hidden="true" />{" "}
                                                            {busyLabel(busy, `feed-${sec.sector}`, "Feeding…", myFeed.on ? "Stop feeding the garrison" : `Feed the garrison · ${GARRISON_RATIONS_PER_DAY} rations/day`)}
                                                        </button>
                                                    ) : (
                                                        <small className="hint"><GiBowlOfRice aria-hidden="true" /> {garrisonFeedStatusLine({ feeding: myFeed.on, sector: sec.sector })}</small>
                                                    )}
                                                    {myFeed.on && <small className="hint">{garrisonFedCapLine(myVillage, myFeed.covered)}</small>}
                                                </div>
                                            )}
                                            {canDeclare && (
                                                <>
                                                    <button
                                                        className="vwm-declare"
                                                        disabled={!!busy || !declareAfford.affordable}
                                                        title={declareAfford.affordable ? undefined : `Your war pool holds ${(myView?.warResources ?? 0).toLocaleString()} WR.`}
                                                        onClick={() => act(`dec-${sec.sector}`, async () => {
                                                            const r = await declareSectorWar(character.name, myVillage, sec.sector);
                                                            const tier = r.intelTier ?? intelTier;
                                                            gameToast(r.alreadyOpen
                                                                ? `Sector ${sec.sector} is already contested.`
                                                                : `War declared on Sector ${sec.sector} for ${Math.max(0, Math.floor(Number(r.cost) || 0))} WR (${intelTierLabel(tier)} intel · base ${Math.max(0, Math.floor(Number(r.intelBaseCost) || 0))} WR).`);
                                                        })}
                                                    >
                                                        {busyLabel(busy, `dec-${sec.sector}`, "Declaring…", declareAfford.label)}
                                                    </button>
                                                    {/* The "~" is explained in visible text, not a tooltip a
                                                        touch player can never reach. */}
                                                    <small className="hint vwm-declare-note">{declareEstimateNote(intelTierLabel(intelTier))}</small>
                                                </>
                                            )}
                                            {contest && isKage && contest.attackerVillage === myVillage && (
                                                <button
                                                    className="vwm-declare"
                                                    disabled={!!busy}
                                                    title="Concede this war. The sector stays with the defender whatever the score, and the War Resources you spent declaring are not refunded."
                                                    onClick={() => act(`aband-${sec.sector}`, () => abandonSectorWar(character.name, sec.sector))}
                                                >
                                                    {busyLabel(busy, `aband-${sec.sector}`, "Conceding…", "Concede War")}
                                                </button>
                                            )}
                                            {contest && contest.winCondition === "card" && (myVillage === contest.attackerVillage || myVillage === contest.defenderVillage) && (
                                                <button className="vwm-declare" disabled={!!busy} onClick={() => launchCardBattle(contest.id)}>⚔ Card Battle</button>
                                            )}
                                            {contest && contest.winCondition === "pet" && (myVillage === contest.attackerVillage || myVillage === contest.defenderVillage) && (
                                                <button className="vwm-declare" disabled={!!busy} onClick={() => launchPetBattle(contest.id)}>🐾 Pet Battle</button>
                                            )}
                                            {contest && contest.winCondition === "combat" && contest.attackerVillage === myVillage && garrisonAssaultable(contest) && (
                                                <button
                                                    className="vwm-declare"
                                                    disabled={!!busy}
                                                    title="No defender has fought here for hours — assault the sector's ANBU garrison instead. A real Solo PvE fight against the defending village's sealed ANBU; worth less than beating a real defender."
                                                    onClick={() => launchGarrisonAssault(sec.sector)}
                                                >
                                                    🛡 Assault Garrison
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
                                    <small className={`vwm-fed-chip${c.fed === false ? " is-unfed" : ""}`}><GiBowlOfRice aria-hidden="true" /> {c.fed === false ? "Unfed" : "Fed"}</small>
                                    {unfedContestIds.has(c.id) && <small className="vwm-dormant"> <GiHazardSign aria-hidden="true" /> {myVillage} marches hungry</small>}
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
