/* eslint-disable react-hooks/purity */
import { useState, useEffect, useCallback, useRef } from "react";
import { serverNow } from "../lib/server-clock";
// Compact local chrome glyphs shared with the rest of the game.
import { GiCrossedSwords, GiScrollUnfurled, GiTrophy, GiEyeball, GiBlackFlag } from "../components/icons/LightweightGameIcons";
const VW_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
import { visiblePoll } from "../lib/poll";
import type { Character, PlayerRecord, VersionedCharacterCommit } from "../types/character";
import { applyAuthoritativeVillageWar, postVillageWarUpdate, villageWarHpMax, VILLAGE_WAR_GROUND_HP_MAX, type VillageWarRecord } from "../lib/world-state";
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
    return `${Math.max(0, Math.floor(Number(war.hp?.[village] ?? 0))).toLocaleString()} / ${villageWarHpMax(war, village).toLocaleString()}`;
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
}: {
    character: Character;
    playerRoster: PlayerRecord[];
    onBack: () => void;
    onVersionedCharacter: VersionedCharacterCommit;
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
            {showWarManual && (
                <div style={{ background: "#0b1220", border: "1px solid #334155", borderRadius: 8, padding: "1rem", marginBottom: "1rem", fontSize: "0.88rem", lineHeight: 1.55 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong style={{ color: "#fde047", fontSize: "1rem" }}><GiScrollUnfurled style={VW_ICON} />Village War Manual</strong>
                        <button type="button" onClick={() => setShowWarManual(false)} style={{ padding: "0.15rem 0.5rem", background: "#7f1d1d", borderColor: "#ef4444", color: "#fca5a5", fontSize: "0.75rem" }}>✕ Close</button>
                    </div>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>Declaring war.</strong> Only your village's <em>seated Kage</em> can declare. It costs <strong>800 War Resources</strong> from the village's war pool, less while your village holds fewer than 4 sectors (free at 0, then 25% / 50% / 75% of the price at 1 / 2 / 3). If the war system is switched off, it costs the Kage <strong>500 Honor Seals</strong> instead. Fighting starts 1 hour after the declaration. The same two villages have a <strong>7-day rematch cooldown</strong> after a war ends. Each village can only be in <strong>one war at a time</strong>, and not while it fights a sector war.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>How damage works.</strong> Each village starts with <strong>5,000 war HP</strong> (Ramparts add 1.5% per level), plus a shared <strong>1,000-HP war ground</strong>. Every PvP win against the enemy village damages the loser's village: the winner's rank sets the damage, and a high-rank loser adds a penalty.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 0, border: "1px solid #334155", borderRadius: 6, overflow: "hidden", marginBottom: "0.6rem", fontSize: "0.82rem" }}>
                        <div style={{ background: "#1e293b", padding: "0.35rem 0.6rem", fontWeight: 700, color: "#fde047" }}>Position</div>
                        <div style={{ background: "#1e293b", padding: "0.35rem 0.6rem", fontWeight: 700, color: "#4ade80", textAlign: "right" }}>You win</div>
                        <div style={{ background: "#1e293b", padding: "0.35rem 0.6rem", fontWeight: 700, color: "#f87171", textAlign: "right" }}>You lose</div>
                        <div style={{ padding: "0.3rem 0.6rem" }}>Seated Kage</div>
                        <div style={{ padding: "0.3rem 0.6rem", textAlign: "right", color: "#4ade80" }}>+30 enemy HP</div>
                        <div style={{ padding: "0.3rem 0.6rem", textAlign: "right", color: "#f87171" }}>−50 your HP</div>
                        <div style={{ padding: "0.3rem 0.6rem", background: "#0f172a" }}>Village Elder</div>
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
                        Both columns stack on the same fight. Examples: a regular villager defeating a Kage = <strong style={{ color: "#4ade80" }}>+5 enemy HP</strong> (their win) AND <strong style={{ color: "#f87171" }}>−50 to the Kage's village</strong> (kill penalty) = <strong>55 total damage</strong>. Kage beats Elder = +30 +20 = 50. Regular vs regular = +5. PvP wins in the war ground drain the war ground AND the enemy village HP at the same time. Clan titles do not count here: only the Kage seat, Village Elder seats and ANBU raise the damage.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>Home defender bonus.</strong> When you win a PvP fight in a sector your own village owns, you get <strong>+15%</strong> war HP credit. This only scales the war ledger — the actual fight is unchanged.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>The war ground (tug of war).</strong> PvP wins inside the war-ground sector deal bonus damage and drain its 1,000 HP. Breaking it captures the war ground: <strong>+100 damage</strong> to the enemy village, and its HP resets to 500 so the other side can take it back. It can change hands many times, but capturing it never changes who owns the sector.</p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>War Ground Bounty.</strong> Your first PvP win in the war ground each UTC day pays <strong>+500 ryo + 1 Fate Shard</strong>, whoever wins the war.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>Daily war missions.</strong> Every 3 war-ground wins complete a war mission. Claim it in the Logbook for <strong>30 damage</strong> to the enemy village, up to 2 a day.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>Winning the war.</strong> A village wins when the <em>enemy's war HP hits 0</em>, or when the enemy Kage surrenders. Capturing the war ground only deals bonus damage; it doesn't end the war alone. Peace needs <strong>both Kages</strong> to agree, and ends the war with no winner.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>Decay.</strong> From day 4, both sides lose <strong>500 war HP per UTC reset</strong> to push idle wars toward an end. A war still running after 14 days ends with no winner.
                    </p>
                    <p style={{ margin: "0 0 0.5rem" }}>
                        <strong style={{ color: "#60a5fa" }}>Rewards.</strong>
                        <br />• <strong>Winning villagers who fought</strong> (dealt war damage, or are the MVP): 1× Legendary War Crate.
                        <br />• <strong>MVP each side</strong> (top damage on the leaderboard): +1 extra Legendary Crate, +10,000 ryo, +50 Honor Seals, +2 Fate Shards. Even the losing-side MVP earns this.
                        <br />• <strong>Losing villagers who contributed ≥50 damage:</strong> 5,000 ryo, 25 Honor Seals, 1 Fate Shard consolation. No consolation after a peace or a draw.
                        <br />• The winning village also takes spoils from the loser's village treasury.
                    </p>
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.8rem" }}>
                        Rewards auto-claim on your next login or the next time you open this screen — no buttons to click for the standard crate.
                    </p>
                </div>
            )}
            {loadError && <div role="status" style={{ color: "#fbbf24", marginBottom: "0.5rem" }}><GameArtIcon kind="warning" size={16} /> Could not refresh the war ({loadError}). Retrying automatically.</div>}
            {actionError && <div role="alert" style={{ color: "#f87171", marginBottom: "0.5rem" }}><GameArtIcon kind="warning" size={16} /> {actionError}</div>}
            {notice && <div role="status" style={{ color: "#4ade80", marginBottom: "0.5rem" }}>{notice}</div>}
            {claimable.length > 0 && (
                <div style={{ background: "linear-gradient(#1a3a1a,#0a2010)", border: "1px solid #4ade80", borderRadius: 8, padding: "0.8rem", marginBottom: "1rem" }}>
                    <strong style={{ color: "#4ade80" }}><GiTrophy style={VW_ICON} />Victory rewards available</strong>
                    {claimable.map(w => (
                        <div key={w.warCrateId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                            <span>vs {w.villages.find(v => v !== myVillage) ?? "?"} — won {new Date(w.endedAt).toLocaleDateString()}</span>
                            <button disabled={Boolean(claimingCrate)} onClick={() => claimVictory(w)} style={{ padding: "0.3rem 0.7rem", background: "linear-gradient(#1a3a1a,#0a2010)", borderColor: "#4ade80", fontSize: "0.85rem" }}>
                                {claimingCrate === w.warCrateId ? "Claiming…" : "Claim Reward"}
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
                            <div style={{ marginTop: 8, padding: "0.5rem 0.7rem", background: "linear-gradient(#3b2a05, #1f1402)", border: "1px solid #fbbf24", borderRadius: 6 }}>
                                <strong style={{ color: "#fde047" }}><GameArtIcon kind="mission" size={16} /> War starts in {Math.max(1, Math.ceil((activeWar.pendingUntil - serverNow()) / 60_000))} min</strong>
                                <p style={{ fontSize: "0.78rem", color: "#fcd34d", margin: "4px 0 0" }}>
                                    Pre-war window. No HP can drop, no PvP raid will count yet. Use this time to rally your village, queue guards, and gather pre-fight buffs.
                                </p>
                            </div>
                        )}
                        <div style={{ marginTop: 8 }}>
                            <div>My village HP: <strong style={{ color: "#4ade80" }}>{warHpText(activeWar, myVillage)}</strong></div>
                            <div>Enemy HP: <strong style={{ color: "#f87171" }}>{warHpText(activeWar, enemyVillage)}</strong></div>
                            <div>War Ground (Sector {activeWar.warGroundSector}): {Math.max(0, Math.floor(Number(activeWar.warGroundHp) || 0)).toLocaleString()} / {VILLAGE_WAR_GROUND_HP_MAX.toLocaleString()}{activeWar.capturedBy ? ` · held by ${activeWar.capturedBy}` : ""}</div>
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
                        records the war damage each fighter dealt (PvP wins,
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
                                        ? <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "0.4rem 0 0" }}>No war damage yet. Win a fight against {enemyVillage} to start.</p>
                                        : mySide.map((c, i) => (
                                            <div key={c.name} style={{ fontSize: "0.85rem", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                                                <span>{i + 1}. <strong>{c.name}</strong></span>
                                                <span style={{ color: "#fde047" }}>{c.damage.toLocaleString()} war damage</span>
                                            </div>
                                        ))}
                                </div>
                                <div style={{ background: "#1f0a0a", border: "1px solid #f87171", borderRadius: 6, padding: "0.6rem" }}>
                                    <strong style={{ color: "#f87171" }}><GiCrossedSwords style={VW_ICON} />{enemyVillage} Top Fighters</strong>
                                    {enemySide.length === 0
                                        ? <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "0.4rem 0 0" }}>{enemyVillage} has dealt no war damage yet.</p>
                                        : enemySide.map((c, i) => (
                                            <div key={c.name} style={{ fontSize: "0.85rem", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                                                <span>{i + 1}. <strong>{c.name}</strong></span>
                                                <span style={{ color: "#fde047" }}>{c.damage.toLocaleString()} war damage</span>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        );
                    })()}
                    {/* How the war is fought now. Read-only: there is no raid
                        button. A war is won by fighting, and it never changes
                        who owns a sector. */}
                    <div style={{ background: "#0b1220", border: "1px solid #334155", borderRadius: 8, padding: "0.8rem", fontSize: "0.88rem", lineHeight: 1.5 }}>
                        <h3 style={{ margin: "0 0 0.4rem" }}><GiBlackFlag style={VW_ICON} />How to fight this war</h3>
                        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                            <li><strong>Win PvP fights against {enemyVillage} shinobi</strong>, anywhere in the world. Every win damages {enemyVillage}'s war HP, and higher ranks hit harder.</li>
                            <li><strong>Fight in the war ground, Sector {activeWar.warGroundSector}.</strong> Wins there deal bonus damage and wear the war ground down. Breaking it captures the war ground for 100 more. Your first war-ground win each day also pays 500 ryo and 1 Fate Shard.</li>
                            <li><strong>Complete daily war missions</strong> in the Logbook. Every 3 war-ground wins earn a mission worth 30 damage, up to 2 a day.</li>
                        </ul>
                        <p style={{ margin: "0.4rem 0 0", fontSize: "0.8rem", color: "#94a3b8" }}>A war never changes who owns a sector.</p>
                    </div>
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
                                <p style={{ fontSize: "0.8rem", color: "#fbbf24", marginTop: 0, marginBottom: "0.5rem" }}>
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
                                    {declaring ? "Declaring…" : <><GameArtIcon kind="attack" size={17} /> Declare War</>}
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
                                            <span style={{ color: "#94a3b8" }}>War Ground: {Math.max(0, Math.floor(Number(w.warGroundHp) || 0)).toLocaleString()} / {VILLAGE_WAR_GROUND_HP_MAX.toLocaleString()}</span>
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
