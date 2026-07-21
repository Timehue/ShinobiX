import type React from "react";
import type { Character } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { CreatorMission } from "../types/missions";
import type { Screen } from "../types/core";
import { HUNTER_RANKUP, HUNTER_RANK_COLORS, HUNTER_RANK_LABELS, HUNT_MATERIAL_NAMES, HUNT_MIN_RANK, type MissionRank } from "../constants/hunter";
import { rewardSummary } from "../lib/currency";
import { boostAmount, getMissionRewardBonus } from "../lib/village-upgrades";
import { dailyHuntsCompleted, hasDailyHuntSlot, dailyHuntCap } from "../lib/character-progress";
import { postClaimMission, applyServerMissionReward, claimReasonMessage } from "../lib/claim-mission";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { starterItems } from "../data/starter-items";
import { builtinHuntMissions } from "../data/missions";
import { beastPortrait, huntMaterialIcon, hunterRankBadge, HUNTER_GUILD_BACKDROP, APEX_CONTRACT_BANNER } from "../data/hunter-art";
import { clearHuntQuality } from "../lib/hunt-run-state";
import {
    APEX_FATE_SHARDS,
    APEX_RYO,
    APEX_XP,
    apexBeastForWeek,
    apexClaimedThisWeek,
    canTakeApex,
    isoWeekKey,
} from "../lib/apex-contract";
import "./HunterBoard.apex.css";
import { gainXp } from "../App";
import { rankUpHunterServer } from "../lib/hunter-rank-api";
import { countItem } from "../lib/inventory";
import { requireServerSettlement } from "../lib/server-settlement-gate";

export function HunterBoard({
    character,
    updateCharacter,
    creatorAis,
    acceptedMissionIds,
    setAcceptedMissionIds,
    missionProgress,
    setMissionProgress,
    // Was declared in the prop type but never destructured — a leftover from an
    // older "fight straight from the board" path. The Apex Contract is exactly
    // that, so it finally has a use.
    setPendingAiProfileId,
    setScreen,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    creatorAis: CreatorAi[];
    acceptedMissionIds: string[];
    setAcceptedMissionIds: React.Dispatch<React.SetStateAction<string[]>>;
    missionProgress: Record<string, number>;
    setMissionProgress: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    setPendingAiProfileId: (id: string) => void;
    setScreen: (s: Screen) => void;
}) {
    const hunterRank = character.hunterRank ?? 0;
    const huntCap = dailyHuntCap(character);
    const missionRewardBonus = getMissionRewardBonus(character) + getActiveAuraSphereBonuses(character).missionRewardPercent;

    function invCount(itemId: string) {
        return countItem(character, itemId);
    }

    async function rankUp() {
        if (!requireServerSettlement("fieldHuntMissions")) return;
        if (hunterRank >= HUNTER_RANKUP.length) return alert("You have reached the highest Hunter Rank.");
        const req = HUNTER_RANKUP[hunterRank];
        if (invCount(req.itemId) < req.qty) {
            return alert(`You need ${req.qty}x ${HUNT_MATERIAL_NAMES[req.itemId]} to advance your Hunter Rank.`);
        }
        try {
            updateCharacter(await rankUpHunterServer(character.name));
            alert(`Hunter Rank advanced! You are now a ${HUNTER_RANK_LABELS[hunterRank + 1]}.`);
        } catch (error) {
            alert(error instanceof Error ? error.message : "Hunter Rank advancement failed.");
        }
    }

    function acceptHunt(mission: CreatorMission) {
        if (!requireServerSettlement("fieldHuntMissions")) return;
        if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`);
        if ((HUNT_MIN_RANK[mission.rank] ?? 0) > hunterRank) return alert(`Requires Hunter Rank: ${HUNTER_RANK_LABELS[HUNT_MIN_RANK[mission.rank] ?? 0]}.`);
        if (acceptedMissionIds.includes(mission.id)) return;
        setAcceptedMissionIds((prev) => [...prev, mission.id]);
        // Reset tracking to 0 on accept — never inherit a stale value left in the
        // shared map, which would make the contract instantly (falsely) claimable.
        setMissionProgress((prev) => ({ ...prev, [mission.id]: 0 }));
        // Same reasoning for Hunt Quality: a re-accepted contract starts neutral,
        // never inheriting the tracking decisions of a previous run.
        clearHuntQuality(mission.id);
        alert(`${mission.name} accepted. Head to Sector ${mission.targetSector} and use Hunt ${mission.exploreCount} time(s) to track the beast.`);
    }

    function materialNames(itemIds: string[]): string[] {
        return itemIds.map((id) => starterItems.find((i) => i.id === id)?.name ?? id);
    }

    async function claimHunt(mission: CreatorMission) {
        if (!requireServerSettlement("fieldHuntMissions")) return;
        const progress = missionProgress[mission.id] ?? 0;
        if (progress < mission.exploreCount) return alert(`Hunt the beast ${mission.exploreCount - progress} more time(s) in Sector ${mission.targetSector}.`);
        if (!hasDailyHuntSlot(character)) return alert(`Daily hunt limit reached (${huntCap}/${huntCap}). Resets at midnight UTC.`);

        // Server-authoritative for built-in hunts (audit M-1): the server resolves
        // the reward from its trusted catalog, enforces the daily hunt cap, and
        // grants the material drops so none of it can be minted client-side.
        // Unknown/creator-authored hunt ids are rejected instead of paid locally.
        const result = await postClaimMission(character.name, "hunt", mission.id);
        if (result === null) return alert("Could not reach the server. Try again.");
        if (result.applied === true) {
            updateCharacter((prev) => (prev ? applyServerMissionReward(prev, result, gainXp) : prev));
            setAcceptedMissionIds((prev) => prev.filter((id) => id !== mission.id));
            setMissionProgress((prev) => ({ ...prev, [mission.id]: 0 }));
            clearHuntQuality(mission.id);
            alert(`${mission.name} complete! ${rewardSummary(result.reward.xpBoosted, result.reward.ryo, result.reward.stamina, result.reward.currency, character, { territoryScrolls: result.reward.territoryScrolls, items: materialNames(result.reward.items ?? []) })}.`);
            return;
        }
        if (result.applied === false) {
            if (result.reason === "already-claimed-today" || result.reason === "already-claimed") {
                // Server already paid this hunt today — reconcile the local board so a
                // desynced client stops showing a dead Claim button on a done contract.
                setAcceptedMissionIds((prev) => prev.filter((id) => id !== mission.id));
                setMissionProgress((prev) => ({ ...prev, [mission.id]: 0 }));
            } else if (result.reason === "missing-hunt-kill-receipt" || result.reason === "missing-server-evidence") {
                // Self-heal a stale-claim trap. The client marks the hunt complete
                // as soon as Arena reports a win locally, but the server-side kill
                // receipt is written by report-ai-fight — which can 409 (expired or
                // already-spent fight token). That left local progress at `required`,
                // so activeHuntTrails dropped the trail and the beast became
                // unhuntable while the Claim button stayed dead forever.
                // Rolling back to required-1 relights the trail at the target sector
                // so the player can re-fight the beast and re-earn the receipt.
                setMissionProgress((prev) => ({
                    ...prev,
                    [mission.id]: Math.max(0, (mission.exploreCount ?? 1) - 1),
                }));
            }
            return alert(claimReasonMessage(result.reason, result));
        }
    }

    // ── Apex Contract ───────────────────────────────────────────────────────
    const apexWeek = isoWeekKey(new Date());

    /** Straight to the fight: the Apex is already found, there is no trail. */
    function faceApex() {
        if (!requireServerSettlement("fieldHuntMissions")) return;
        if (!canTakeApex(character)) return;
        // apex-ai-* profiles are real builtins (lib/combat-ai.ts), so the Arena
        // resolves them by id with no registration step.
        setPendingAiProfileId(apexBeastForWeek(apexWeek).apexAiId);
        setScreen("arena");
    }

    /**
     * The purse is claimed separately from the kill. The server holds the kill
     * receipt (written by report-ai-fight on a verified win), so the client
     * never has to track whether the beast is down — it asks, and a friendly
     * reason comes back if it isn't.
     */
    async function claimApex() {
        if (!requireServerSettlement("fieldHuntMissions")) return;
        const result = await postClaimMission(character.name, "apex", "apex-weekly");
        if (result === null) return alert("Could not reach the server. Try again.");
        if (result.applied === true) {
            updateCharacter((prev) => (prev ? applyServerMissionReward(prev, result, gainXp) : prev));
            alert(`Apex Contract complete! ${rewardSummary(result.reward.xpBoosted, result.reward.ryo, result.reward.stamina, result.reward.currency, character, { territoryScrolls: result.reward.territoryScrolls, items: materialNames(result.reward.items ?? []) })}.`);
            return;
        }
        if (result.applied === false) alert(claimReasonMessage(result.reason, result));
    }

    const missionRanks: MissionRank[] = ["D Rank", "C Rank", "B Rank", "A Rank", "S Rank"];

    return (
        <div className="hunter-board" style={{
            backgroundImage: `linear-gradient(rgba(10,12,20,.86), rgba(10,12,20,.95)), url(${HUNTER_GUILD_BACKDROP})`,
            backgroundSize: "cover",
            backgroundPosition: "center top",
            backgroundAttachment: "fixed",
        }}>
            <div className="hunter-board-header">
                <button className="back-btn" onClick={() => setScreen("centralHub")}>← Central</button>
                <h2>🎯 Hunter Guild — Contract Board</h2>
                <span
                    className="hunter-daily-chip"
                    style={{ marginLeft: "auto", fontWeight: 600, color: dailyHuntsCompleted(character) >= huntCap ? "#ef4444" : "#fcd34d" }}
                >
                    🎯 Hunts today: {dailyHuntsCompleted(character)}/{huntCap}
                </span>
            </div>

            <div className="hunter-rank-banner">
                <img src={hunterRankBadge(hunterRank)} alt={HUNTER_RANK_LABELS[hunterRank]} className="hunter-rank-emblem" style={{ width: 64, height: 64, flexShrink: 0, filter: "drop-shadow(0 2px 6px rgba(0,0,0,.45))" }} />
                <div className="hunter-rank-info">
                    <span className="hunter-rank-badge" style={{ background: HUNTER_RANK_COLORS[hunterRank] }}>
                        {HUNTER_RANK_LABELS[hunterRank]}
                    </span>
                    <span className="hunter-rank-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {hunterRank < HUNTER_RANKUP.length
                            ? <>
                                {huntMaterialIcon(HUNTER_RANKUP[hunterRank].itemId) && <img src={huntMaterialIcon(HUNTER_RANKUP[hunterRank].itemId)} alt="" style={{ width: 22, height: 22, flexShrink: 0 }} />}
                                <span>{`Rank Up: Turn in ${HUNTER_RANKUP[hunterRank].qty}× ${HUNT_MATERIAL_NAMES[HUNTER_RANKUP[hunterRank].itemId]} (you have ${invCount(HUNTER_RANKUP[hunterRank].itemId)})`}</span>
                            </>
                            : "Maximum Hunter Rank achieved."}
                    </span>
                </div>
                {hunterRank < HUNTER_RANKUP.length && (
                    <button
                        className="rank-up-btn"
                        disabled={invCount(HUNTER_RANKUP[hunterRank].itemId) < HUNTER_RANKUP[hunterRank].qty}
                        onClick={rankUp}
                    >
                        Rank Up ? {HUNTER_RANK_LABELS[Math.min(hunterRank + 1, HUNTER_RANK_LABELS.length - 1)]}
                    </button>
                )}
            </div>

            {/* Apex Contract — the Rank 5 capstone. Hidden entirely below max
                rank so it reads as something to climb toward, not a locked row. */}
            {canTakeApex(character) && (() => {
                const beast = apexBeastForWeek(apexWeek);
                const claimed = apexClaimedThisWeek(character, apexWeek);
                const portrait = beastPortrait(beast.apexAiId);
                return (
                    <div
                        className={`apex-contract${claimed ? " is-claimed" : ""}`}
                        style={{ backgroundImage: `linear-gradient(100deg, rgba(20,10,4,.90) 0%, rgba(20,10,4,.62) 45%, rgba(10,12,20,.90) 100%), url(${APEX_CONTRACT_BANNER})` }}
                    >
                        {portrait && <img src={portrait} alt="" className="apex-portrait" />}
                        <div className="apex-body">
                            <span className="apex-kicker">Apex Contract · {apexWeek}</span>
                            <h3 className="apex-name">{beast.name}</h3>
                            <p className="apex-sub">
                                Level {beast.level}. One hunter, one beast, once a week — the Guild
                                pays the purse to whoever walks back.
                            </p>
                            <span className="apex-purse">
                                {APEX_RYO.toLocaleString()} ryo · {APEX_FATE_SHARDS} Fate Shards · {APEX_XP.toLocaleString()} XP
                            </span>
                        </div>
                        <div className="apex-actions">
                            {claimed
                                ? <span className="apex-done">Claimed this week</span>
                                : <>
                                    <button type="button" className="apex-fight" onClick={faceApex}>
                                        Face the Apex
                                    </button>
                                    <button type="button" className="apex-claim" onClick={claimApex}>
                                        Claim Purse
                                    </button>
                                </>}
                        </div>
                    </div>
                );
            })()}

            {missionRanks.map((rank) => {
                const minRank = HUNT_MIN_RANK[rank] ?? 0;
                const missions = builtinHuntMissions.filter((m) => m.rank === rank);
                const locked = hunterRank < minRank;
                return (
                    <section key={rank} className={`hunt-rank-section ${locked ? "hunt-rank-locked" : ""}`}>
                        <h3 className="hunt-rank-heading">
                            <span className="hunter-rank-badge" style={{ background: HUNTER_RANK_COLORS[minRank] }}>{rank}</span>
                            {locked && <span className="hunt-lock-label">🔒 Requires {HUNTER_RANK_LABELS[minRank]}</span>}
                        </h3>
                        {!locked && (
                            <div className="hunt-contract-grid">
                                {missions.map((mission) => {
                                    const accepted = acceptedMissionIds.includes(mission.id);
                                    const progress = missionProgress[mission.id] ?? 0;
                                    const complete = progress >= mission.exploreCount;
                                    const beastAi = creatorAis.find((a) => a.id === mission.aiProfileId);
                                    return (
                                        <div key={mission.id} className="hunt-contract-card">
                                            <div className="hunt-contract-top">
                                                {beastPortrait(mission.aiProfileId)
                                                    ? <img className="hunt-beast-portrait" src={beastPortrait(mission.aiProfileId)} alt={beastAi?.name ?? mission.name} style={{ width: 76, height: 76, objectFit: "cover", borderRadius: 10, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,.4)" }} />
                                                    : <span className="hunt-beast-icon">{beastAi?.icon ?? "🐾"}</span>}
                                                <div className="hunt-contract-info">
                                                    <strong>{mission.name}</strong>
                                                    <small>Sector {mission.targetSector} · Lvl {mission.levelReq}+</small>
                                                    <small>{rewardSummary(boostAmount(mission.xpReward, missionRewardBonus), boostAmount(mission.ryoReward, missionRewardBonus), boostAmount(mission.staminaReward, missionRewardBonus), mission.currencyRewards, character)}</small>
                                                    {mission.itemRewards && (
                                                        <div className="hunt-drops" style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                                                            <span style={{ opacity: .7, fontSize: 11 }}>Drops:</span>
                                                            {[...new Set(mission.itemRewards)].map((id) => {
                                                                const name = starterItems.find((i) => i.id === id)?.name ?? id;
                                                                const icon = huntMaterialIcon(id);
                                                                return icon
                                                                    ? <img key={id} src={icon} alt={name} title={name} style={{ width: 24, height: 24 }} />
                                                                    : <span key={id} style={{ fontSize: 11 }}>{name}</span>;
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <p className="hunt-description">{mission.description}</p>
                                            {accepted && (
                                                <>
                                                    <div className="hunt-progress-bar">
                                                        <div className="hunt-progress-fill" style={{ width: `${Math.min(100, (progress / mission.exploreCount) * 100)}%` }} />
                                                    </div>
                                                    <span className="hunt-progress-label">Hunted {progress}/{mission.exploreCount}</span>
                                                </>
                                            )}
                                            <div className="menu">
                                                {!accepted
                                                    ? <button onClick={() => acceptHunt(mission)}>Accept Hunt</button>
                                                    : complete
                                                        ? <button onClick={() => claimHunt(mission)}>Claim Reward</button>
                                                        : <button onClick={() => setScreen("worldMap")}>Go To Sector {mission.targetSector}</button>
                                                }
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                );
            })}
        </div>
    );
}
