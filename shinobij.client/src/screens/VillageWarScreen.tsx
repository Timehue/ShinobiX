/* eslint-disable react-hooks/purity */
import { useState, useEffect, useCallback, useRef } from "react";
import { VillageCampaignPanel } from '../features/villageWar/VillageCampaignPanel';
import { serverNow } from "../lib/server-clock";
// Compact local chrome glyphs shared with the rest of the game.
import { GiCrossedSwords, GiTrophy, GiEyeball } from "../components/icons/LightweightGameIcons";
const VW_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
import { visiblePoll } from "../lib/poll";
import type { Character, PlayerRecord, VersionedCharacterCommit } from "../types/character";
import { applyAuthoritativeVillageWar, postVillageWarUpdate, type VillageWarRecord } from "../lib/world-state";
import { clearWarMapCache } from "../lib/village-war-map";
import {
    claimableVillageWarCrates,
    loadWarDeclareQuote,
    mergeAdoptedWarRows,
    postVillageWarCommand,
    villageWarPeaceView,
    villageWarRow,
    warAcceptPeaceConfirmText,
    warCrateDeclineMessage,
    warDeclareBlockReason,
    warDeclareConfirmText,
    warDeclareCostText,
    warSurrenderConfirmText,
    type AdoptedWarRow,
    type VillageWarCommand,
    type WarDeclareQuote,
} from "../lib/village-war-hall";
import { gameConfirm } from "../components/GameAlert";
import { GameArtIcon } from "../components/GameArtIcon";

// "4,620 / 5,075": a village's war HP against its own max (Ramparts raise it).
function warHpText(war: VillageWarRecord, village: string): string {
    return `${Math.max(0, Math.floor(Number(war.warPoints?.[village] ?? 0))).toLocaleString()} War Points`;
}

// ─── Village War Screen ───────────────────────────────────────────────────────
// Lets a village member follow the active war (if any) and claim a won war's
// crate. The seated Kage can also declare a war, offer or accept peace, or
// surrender. Every action is a server command: this screen never moves war HP,
// a war-ground capture or a sector's owner itself.
export function VillageWarScreen({
    character,
    playerRoster,
    onBack,
    onVersionedCharacter,
    sharedImages = {},
}: {
    character: Character;
    playerRoster: PlayerRecord[];
    onBack: () => void;
    onVersionedCharacter: VersionedCharacterCommit;
    sharedImages?: Record<string, string>;
}) {
    const [wars, setWars] = useState<VillageWarRecord[]>([]);
    const [loading, setLoading] = useState(true);
    // A failed poll and a refused action are kept apart: the next good poll
    // clears the first, and starting another action clears the second.
    const [loadError, setLoadError] = useState("");
    const [actionError, setActionError] = useState("");
    const [notice, setNotice] = useState("");
    const [declaring, setDeclaring] = useState(false);
    const [declareTarget, setDeclareTarget] = useState("");
    const [declareQuote, setDeclareQuote] = useState<WarDeclareQuote | null>(null);
    const [quoteRequest, setQuoteRequest] = useState(0);
    const [commandBusy, setCommandBusy] = useState<VillageWarCommand | null>(null);
    const [claimingCrate, setClaimingCrate] = useState("");
    // Crates this screen already has a server answer for (granted or declined),
    // so the banner clears at once instead of offering a dead button.
    const [settledCrates, setSettledCrates] = useState<ReadonlySet<string>>(() => new Set());
    // Rows the server returned from this screen's own commands. The world-state
    // poll can be served from a cache a few seconds old, so these stand against
    // an older polled row until the poll catches up (mergeAdoptedWarRows).
    const adoptedWars = useRef(new Map<string, AdoptedWarRow>());
    const [kageSeat, setKageSeat] = useState<{ village: string; name: string } | null>(null);
    const isKage = kageSeat?.village === character.village && kageSeat.name.toLowerCase() === character.name.toLowerCase();
    // Tutorial popover — toggled by the ℹ button next to the page
    // header. Same UX pattern as the per-jutsu info popovers in PvP.
    const [showWarManual, setShowWarManual] = useState(false);

    useEffect(() => {
        let alive = true;
        const refreshKage = () => fetch(`/api/village/kage?village=${encodeURIComponent(character.village)}`, { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null).then(data => {
                if (alive) setKageSeat({ village: character.village, name: String(data?.seatedKage ?? '') });
            }).catch(() => { if (alive) setKageSeat(null); });
        const stop = visiblePoll(refreshKage, 12000, 0.1, { immediate: true });
        return () => { alive = false; stop(); };
    }, [character.name, character.village]);

    const refresh = useCallback(async () => {
        try {
            const r = await fetch("/api/world-state", { method: "GET" });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            const merged = mergeAdoptedWarRows(Array.isArray(data.wars) ? data.wars : [], adoptedWars.current, Date.now());
            adoptedWars.current = merged.pending;
            setWars(merged.wars);
            setLoadError("");
        } catch (e) {
            setLoadError(String((e as Error).message || e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => visiblePoll(refresh, 15000, 0.1, { immediate: true }), [refresh]);

    // Adopt the row a server command returned: into this screen at once, and
    // into the shared cache so the rest of the game sees it before the next poll.
    const adoptWar = useCallback((raw: unknown) => {
        const row = villageWarRow(raw);
        if (!row) return;
        applyAuthoritativeVillageWar(row);
        adoptedWars.current.set(row.id, { row, at: Date.now() });
        const adopted = new Map(adoptedWars.current);
        const now = Date.now();
        setWars(previous => mergeAdoptedWarRows(previous, adopted, now).wars);
    }, []);

    const myVillage = (character.village ?? "").trim();
    const activeWar = wars.find(w => !w.endedAt && Array.isArray(w.villages) && w.villages.includes(myVillage));
    const enemyVillage = activeWar?.villages?.find((v: string) => v !== myVillage) ?? "";
    const villages = Array.from(new Set(playerRoster.map(p => p.village).filter(Boolean))).filter(v => v !== myVillage);

    // The declare panel is the Kage's alone, and only while no war runs, so the
    // price is read only then. With the war system on (the default) the village's
    // War Resources pay, discounted by how few sectors it holds; only when the
    // system is switched off (the war map answers 404) does the Kage's own
    // Honor Seal purse pay instead.
    const showDeclarePanel = isKage && !loading && !activeWar;
    useEffect(() => {
        if (!showDeclarePanel || !myVillage) return;
        let alive = true;
        void loadWarDeclareQuote(myVillage).then(quote => { if (alive) setDeclareQuote(quote); });
        return () => { alive = false; };
    }, [showDeclarePanel, myVillage, quoteRequest]);

    async function declareWar() {
        if (!declareTarget || declaring) return;
        setDeclaring(true);
        setActionError("");
        setNotice("");
        try {
            // The server prices the declaration, debits the payer and stamps the
            // row. A refusal (cost, cooldown, a war already running) comes back
            // as a sentence and is shown as is.
            const { status, data } = await postVillageWarUpdate({
                kind: "war",
                war: { villages: [myVillage, declareTarget], startedAt: Date.now() },
            });
            if (status < 200 || status >= 300) throw new Error(String(data?.error ?? `HTTP ${status}`));
            adoptWar(data?.war);
            await refresh();
        } catch (e) {
            setActionError(e instanceof TypeError ? "The server could not be reached. Try again." : String((e as Error).message || e));
        } finally {
            // The village pool moved, or the refusal says why it could not:
            // drop the war-map memo and read the price again.
            clearWarMapCache();
            setQuoteRequest(n => n + 1);
            setDeclaring(false);
        }
    }

    // Kage commands. A no-winner peace needs both Kages (the second offer ends
    // the war); surrendering ends it as a loss. The server checks the seat.
    async function runWarCommand(command: VillageWarCommand) {
        if (!activeWar || !enemyVillage || commandBusy) return;
        if (command === "surrender") {
            const confirmed = await gameConfirm(warSurrenderConfirmText(myVillage, enemyVillage), {
                title: "Surrender the war?",
                confirmLabel: "Surrender",
                cancelLabel: "Keep fighting",
                danger: true,
                initialFocus: "cancel",
            });
            if (!confirmed) return;
        } else if (command === "propose-peace" && villageWarPeaceView(activeWar, myVillage, enemyVillage).enemyOfferAt) {
            const confirmed = await gameConfirm(warAcceptPeaceConfirmText(enemyVillage), {
                title: "Accept peace?",
                confirmLabel: "Accept peace",
                cancelLabel: "Keep fighting",
            });
            if (!confirmed) return;
        }
        setCommandBusy(command);
        setActionError("");
        setNotice("");
        const result = await postVillageWarCommand(command, myVillage, enemyVillage);
        setCommandBusy(null);
        if (!result.ok) return setActionError(result.error);
        adoptWar(result.war);
        void refresh();
    }

    if (loading) return <div className="card" style={{ padding: "1.4rem", maxWidth: 720, margin: "1rem auto" }}>Loading village war…</div>;

    // Won wars whose winner's crate this player earned (they fought) and has not
    // claimed yet, under the server-stamped crate id.
    const claimable = claimableVillageWarCrates(wars, character, serverNow(), settledCrates);

    async function claimVictory(war: VillageWarRecord & { warCrateId: string }) {
        // Canonical winner reward: 1× Legendary War Crate, dedup via
        // claimedWarCrateIds. It uses the server-stamped warCrateId — a rematch
        // carries a `-g<generation>` suffix, so a rebuilt `war-crate-<id>` never
        // matched and the button did nothing. The claim sweep uses the same id,
        // so whichever path runs first delivers the crate once.
        const crateId = war.warCrateId;
        if (claimingCrate || (character.claimedWarCrateIds ?? []).includes(crateId)) return;
        setClaimingCrate(crateId);
        setActionError("");
        setNotice("");
        try {
            const response = await fetch("/api/village/claim-war-crate", {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: character.name, warCrateId: crateId }),
            }).catch(() => null);
            const data = response ? await response.json().catch(() => null) as { granted?: boolean; reason?: string; character?: Character; _saveVersion?: number } | null : null;
            if (!response?.ok || !data) return setActionError('The war reward could not be verified. It will retry on the next refresh.');
            setSettledCrates(previous => new Set(previous).add(crateId));
            // A decline is final for this crate (already claimed, expired, or not
            // earned). Its save is the stored one, unchanged: adopting it could
            // only paint over unsaved local edits, so it is left alone.
            if (data.granted !== true) {
                const message = warCrateDeclineMessage(data.reason);
                return data.reason === "already-claimed" ? setNotice(message) : setActionError(message);
            }
            if (data.character) onVersionedCharacter(data.character, data._saveVersion);
            setNotice("Legendary War Crate claimed. It is in your inventory.");
        } finally {
            setClaimingCrate("");
        }
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
                    How it works
                </button>
            </div>
            {showWarManual && <div className="summary-box">
                <h3>Village War Manual</h3>
                <p>Only a seated Kage can declare war. The village funds the declaration from its War Resources, with the existing comeback discount. Preparation lasts one hour, followed by five full days of scoring.</p>
                <p>A golden shrine appears in a randomly chosen neutral sector for each declaration and opens for one two-hour window per campaign day in new declarations. Measured from scoring start after preparation, the five locked windows are hours 2–4, 31–33, 60–62, 89–91 and 118–120. Each day’s window shifts five hours later. The full schedule shows opening and closing times in your local time; daylight-saving changes do not move the server timestamps. Travel there and enter its room from the sector map; Town Hall shows its status only.</p>
                <p>For new declarations, the first 10 shinobi PvP victories inside earn 20 extra points each, shared across both villages. Every shrine victory also earns normal role points and deducts the defeated player’s role penalty from the enemy score, down to zero, including after the extra-point cap. Kage wins earn 30, Elder 20, ANBU 15 and villager 5 points; losing a Kage costs 50 and an Elder 20. Combat stays open until closing.</p>
                <p>The village with the most accumulated uncontested time earns the 100-point window bonus. Each window offers at most 300 extra shrine points, or 1,500 over five windows; normal role rewards and enemy deductions are outside that pool. Existing declarations retain their original rewards, caps and schedule. Empty and contested time does not count; tied or zero totals award no bonus.</p>
                <p>Each village has three randomly nominated strongholds: one shinobi combat, one pet battle, and one card battle. Each live stronghold victory earns 50 points, with three scored victories and 150 for the objective winner: 300 points per stronghold and 1,800 across all six.</p>
                <p>Supply, Sabotage, and Espionage operations reveal enemy strongholds and earn supporting points. The limits are per player and reset each war day, with no village-wide cap. Each player can use four attempts: at most one Supply, two Sabotage, and two Espionage attempts. ANBU fallback raids share the Sabotage allowance. PvE contributes at most 20% of the total score.</p>
                <p>Enemy player victories anywhere in the world earn 20 points. Spars and ranked matches are excluded. Queue to defend a stronghold from Town Hall; attackers must travel to and enter the enemy stronghold, and its appointed ANBU stands in when no player is queued. Shrine fighters must be physically inside the golden shrine; its fights cannot dispatch a defender from town.</p>
                <p>The higher score wins after five days; equal scores draw. Kages can offer mutual peace or surrender. Existing contribution rewards and seven-day rematch cooldowns still apply. Village wars do not transfer sector ownership.</p>
            </div>}
            {loadError && <div role="status" style={{ color: "#e6c477", marginBottom: "0.5rem" }}><GameArtIcon kind="warning" size={16} /> Live village-war data is temporarily unavailable. Retrying automatically…</div>}
            {actionError && <div role="alert" style={{ color: "#f87171", marginBottom: "0.5rem" }}><GameArtIcon kind="warning" size={16} /> {actionError}</div>}
            {notice && <div role="status" style={{ color: "#4ade80", marginBottom: "0.5rem" }}>{notice}</div>}
            {claimable.length > 0 && (
                <div style={{ background: "linear-gradient(#1a3a1a,#0a2010)", border: "1px solid #4ade80", borderRadius: 8, padding: "0.8rem", marginBottom: "1rem" }}>
                    <strong style={{ color: "#4ade80" }}><GiTrophy style={VW_ICON} />Victory rewards available</strong>
                    {claimable.map(w => (
                        <div key={w.warCrateId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                            <span>vs {w.villages.find(v => v !== myVillage) ?? "?"} — won {new Date(w.endedAt).toLocaleDateString()}</span>
                            <button disabled={Boolean(claimingCrate)} onClick={() => claimVictory(w)} style={{ padding: "0.3rem 0.7rem", background: "linear-gradient(#1a3a1a,#0a2010)", borderColor: "#4ade80", fontSize: "0.85rem" }}>
                                {claimingCrate === w.warCrateId ? "Claiming…" : "Claim reward"}
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
                        {activeWar.pendingUntil && activeWar.pendingUntil > serverNow() && (
                            <div style={{ marginTop: 8, padding: "0.5rem 0.7rem", background: "linear-gradient(#3b2a05, #1f1402)", border: "1px solid #e6c477", borderRadius: 6 }}>
                                <strong style={{ color: "#fde047" }}><GameArtIcon kind="mission" size={16} /> War starts in {Math.max(1, Math.ceil((activeWar.pendingUntil - serverNow()) / 60_000))} min</strong>
                                <p style={{ fontSize: "0.78rem", color: "#fcd34d", margin: "4px 0 0" }}>
                                    Rally your village before the five-day scoring period begins.
                                </p>
                            </div>
                        )}
                        <div style={{ marginTop: 8 }}>
                            <VillageCampaignPanel character={character} warId={activeWar.id} sharedImages={sharedImages} onVersionedCharacter={onVersionedCharacter} />
                        </div>
                        {(() => {
                            // Peace offers are shown to everyone; the buttons are the Kage's.
                            const peace = villageWarPeaceView(activeWar, myVillage, enemyVillage);
                            if (!isKage && !peace.ourOfferAt && !peace.enemyOfferAt) return null;
                            return (
                                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #334155", fontSize: "0.85rem" }}>
                                    {peace.enemyOfferAt && (
                                        <p style={{ margin: "0 0 0.4rem", color: "#93c5fd" }}>
                                            <strong>{enemyVillage}'s Kage has offered peace.</strong> {isKage ? "Accept it to end the war with no winner." : "If our Kage accepts, the war ends with no winner."}
                                        </p>
                                    )}
                                    {peace.ourOfferAt && (
                                        <p style={{ margin: "0 0 0.4rem", color: "#93c5fd" }}>
                                            <strong>Our Kage has offered peace.</strong> If {enemyVillage}'s Kage accepts, the war ends with no winner.
                                        </p>
                                    )}
                                    {isKage && (
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                            <button
                                                type="button"
                                                disabled={Boolean(commandBusy)}
                                                onClick={() => { void runWarCommand(peace.peaceCommand); }}
                                                style={{ padding: "0.35rem 0.8rem", fontSize: "0.85rem", background: "#1e293b", borderColor: "#60a5fa", color: "#bfdbfe" }}
                                            >
                                                {commandBusy === peace.peaceCommand ? "Sending…" : peace.peaceLabel}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={Boolean(commandBusy)}
                                                onClick={() => { void runWarCommand("surrender"); }}
                                                style={{ padding: "0.35rem 0.8rem", fontSize: "0.85rem", background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171", color: "#fecaca" }}
                                            >
                                                {commandBusy === "surrender" ? "Surrendering…" : "Surrender"}
                                            </button>
                                        </div>
                                    )}
                                    {isKage && (
                                        <p style={{ margin: "0.4rem 0 0", fontSize: "0.75rem", color: "#94a3b8" }}>
                                            Peace needs both Kages and ends the war with no winner. Surrendering ends it as a loss: {enemyVillage} wins.
                                        </p>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                    {/* Per-village live contribution leaderboard. The server
                        records the War Points each fighter dealt (PvP wins,
                        war-ground wins, war missions); we show the top 3 on
                        each side so the MVP is visible at a glance. Read-only. */}
                    {(() => {
                        const contribs = Object.values(activeWar.contributions ?? {});
                        if (contribs.length === 0) return null;
                        const mySide = contribs.filter(c => c.side === myVillage).sort((a, b) => b.damage - a.damage).slice(0, 3);
                        const enemySide = contribs.filter(c => c.side === enemyVillage).sort((a, b) => b.damage - a.damage).slice(0, 3);
                        return (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: "1rem" }}>
                                <div style={{ background: "#0a1f0a", border: "1px solid #4ade80", borderRadius: 6, padding: "0.6rem" }}>
                                    <strong style={{ color: "#4ade80" }}><GiTrophy style={VW_ICON} />{myVillage} Top Fighters</strong>
                                    {mySide.length === 0
                                        ? <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "0.4rem 0 0" }}>No War Points yet. Win a fight against {enemyVillage} to start.</p>
                                        : mySide.map((c, i) => (
                                            <div key={c.name} style={{ fontSize: "0.85rem", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                                                <span>{i + 1}. <strong>{c.name}</strong></span>
                                                <span style={{ color: "#fde047" }}>{c.damage.toLocaleString()} War Points</span>
                                            </div>
                                        ))}
                                </div>
                                <div style={{ background: "#1f0a0a", border: "1px solid #f87171", borderRadius: 6, padding: "0.6rem" }}>
                                    <strong style={{ color: "#f87171" }}><GiCrossedSwords style={VW_ICON} />{enemyVillage} Top Fighters</strong>
                                    {enemySide.length === 0
                                        ? <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "0.4rem 0 0" }}>{enemyVillage} has earned no War Points yet.</p>
                                        : enemySide.map((c, i) => (
                                            <div key={c.name} style={{ fontSize: "0.85rem", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                                                <span>{i + 1}. <strong>{c.name}</strong></span>
                                                <span style={{ color: "#fde047" }}>{c.damage.toLocaleString()} War Points</span>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        );
                    })()}
                </>
            ) : (
                <>
                    <p style={{ color: "#94a3b8" }}>No active war involving <strong>{myVillage || "your village"}</strong>.</p>
                    {isKage ? (() => {
                        // Who pays depends on the war system: the village pool when
                        // it is on, the Kage's own seals when it is switched off.
                        const blockReason = warDeclareBlockReason(declareQuote, character.honorSeals ?? 0);
                        return (
                            <div style={{ marginTop: "1rem", padding: "0.8rem", background: "#0a0a1a", borderRadius: 8 }}>
                                <h3 style={{ marginTop: 0 }}>Declare War (Kage)</h3>
                                <p style={{ fontSize: "0.8rem", color: "#e6c477", marginTop: 0, marginBottom: "0.5rem" }}>
                                    Cost: <strong>{warDeclareCostText(declareQuote)}</strong> · Rematch cooldown: 7 days · One war per village at a time
                                </p>
                                <select value={declareTarget} onChange={e => setDeclareTarget(e.target.value)} style={{ padding: "0.4rem", marginRight: "0.5rem" }}>
                                    <option value="">Select target village…</option>
                                    {villages.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                                <button
                                    disabled={!declareTarget || declaring || Boolean(blockReason)}
                                    onClick={async () => {
                                        if (!(await gameConfirm(warDeclareConfirmText(declareQuote, declareTarget), { title: "Declare war?", confirmLabel: "Declare war" }))) return;
                                        void declareWar();
                                    }}
                                    style={{ padding: "0.5rem 1rem", background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171" }}
                                    title={blockReason ?? undefined}
                                >
                                    {declaring ? "Declaring…" : <><GameArtIcon kind="attack" size={17} /> Declare war</>}
                                </button>
                                {blockReason && <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: "0.4rem 0 0" }}>{blockReason}</p>}
                            </div>
                        );
                    })() : (
                        <p style={{ color: "#64748b", fontStyle: "italic" }}>Only the Kage of your village can declare war.</p>
                    )}
                </>
            )}
            {/* Spectator section — any other active wars in the world.
                Read-only HP + each side's top fighter so players can keep
                an eye on cross-village politics even when their own
                village isn't fighting. */}
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
                                const contribs = Object.values(w.contributions ?? {});
                                const topA = contribs.filter(c => c.side === vA).sort((a, b) => b.damage - a.damage)[0];
                                const topB = contribs.filter(c => c.side === vB).sort((a, b) => b.damage - a.damage)[0];
                                const ageDays = Math.floor((serverNow() - w.startedAt) / (24 * 60 * 60 * 1000));
                                return (
                                    <div key={w.id} style={{ background: "#0b1220", border: "1px solid #334155", borderRadius: 6, padding: "0.65rem" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                            <strong>{vA} <span style={{ color: "#64748b" }}>vs</span> {vB}</strong>
                                            <small style={{ color: "#64748b" }}>Day {ageDays + 1}</small>
                                        </div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: "0.82rem", marginTop: 4 }}>
                                            <span style={{ color: "#4ade80" }}>{vA}: <strong>{warHpText(w, vA)}</strong></span>
                                            <span style={{ color: "#f87171" }}>{vB}: <strong>{warHpText(w, vB)}</strong></span>
                                            <span style={{ color: "#94a3b8" }}>War Shrine: Sector {w.warGroundSector}</span>
                                        </div>
                                        {(topA || topB) && (
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: "0.78rem", marginTop: 4, color: "#94a3b8" }}>
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
