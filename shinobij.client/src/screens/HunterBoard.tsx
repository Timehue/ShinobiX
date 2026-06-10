import type { Character } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { CreatorMission } from "../types/missions";
import type { Screen } from "../types/core";
import { DAILY_HUNT_LIMIT } from "../constants/game";
import { HUNTER_RANKUP, HUNTER_RANK_COLORS, HUNTER_RANK_LABELS, HUNT_MATERIAL_NAMES, HUNT_MIN_RANK, type MissionRank } from "../constants/hunter";
import { applyCurrencyRewards, rewardSummary } from "../lib/currency";
import { boostAmount, getMissionRewardBonus } from "../lib/village-upgrades";
import { dailyHuntsCompleted, hasDailyHuntSlot, markHuntCompleted } from "../lib/character-progress";
import { effectiveCharacterXpGain } from "../lib/progression";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { starterItems } from "../data/starter-items";
import { builtinHuntMissions } from "../data/missions";
import { gainXp, grantTerritoryScrolls } from "../App";

export function HunterBoard({
    character,
    updateCharacter,
    creatorAis,
    acceptedMissionIds,
    setAcceptedMissionIds,
    missionProgress,
    setMissionProgress,
    setScreen,
}: {
    character: Character;
    updateCharacter: (c: Character) => void;
    creatorAis: CreatorAi[];
    acceptedMissionIds: string[];
    setAcceptedMissionIds: (ids: string[]) => void;
    missionProgress: Record<string, number>;
    setMissionProgress: (p: Record<string, number>) => void;
    setPendingAiProfileId: (id: string) => void;
    setScreen: (s: Screen) => void;
}) {
    const hunterRank = character.hunterRank ?? 0;
    const missionRewardBonus = getMissionRewardBonus(character) + getActiveAuraSphereBonuses(character).missionRewardPercent;

    function invCount(itemId: string) {
        return character.inventory.filter((id) => id === itemId).length;
    }

    function removeFromInventory(inv: string[], itemId: string, qty: number): string[] {
        let removed = 0;
        return inv.filter((id) => {
            if (id === itemId && removed < qty) { removed++; return false; }
            return true;
        });
    }

    function rankUp() {
        if (hunterRank >= HUNTER_RANKUP.length) return alert("You have reached the highest Hunter Rank.");
        const req = HUNTER_RANKUP[hunterRank];
        if (invCount(req.itemId) < req.qty) {
            return alert(`You need ${req.qty}x ${HUNT_MATERIAL_NAMES[req.itemId]} to advance your Hunter Rank.`);
        }
        const newInv = removeFromInventory(character.inventory, req.itemId, req.qty);
        updateCharacter({ ...character, inventory: newInv, hunterRank: hunterRank + 1 });
        alert(`Hunter Rank advanced! You are now a ${HUNTER_RANK_LABELS[hunterRank + 1]}.`);
    }

    function acceptHunt(mission: CreatorMission) {
        if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`);
        if ((HUNT_MIN_RANK[mission.rank] ?? 0) > hunterRank) return alert(`Requires Hunter Rank: ${HUNTER_RANK_LABELS[HUNT_MIN_RANK[mission.rank] ?? 0]}.`);
        if (acceptedMissionIds.includes(mission.id)) return;
        setAcceptedMissionIds([...acceptedMissionIds, mission.id]);
        setMissionProgress({ ...missionProgress, [mission.id]: missionProgress[mission.id] ?? 0 });
        alert(`${mission.name} accepted. Head to Sector ${mission.targetSector} and use Hunt ${mission.exploreCount} time(s) to track the beast.`);
    }

    function claimHunt(mission: CreatorMission) {
        const progress = missionProgress[mission.id] ?? 0;
        if (progress < mission.exploreCount) return alert(`Hunt the beast ${mission.exploreCount - progress} more time(s) in Sector ${mission.targetSector}.`);
        if (!hasDailyHuntSlot(character)) return alert(`Daily hunt limit reached (${DAILY_HUNT_LIMIT}/${DAILY_HUNT_LIMIT}). Resets at midnight UTC.`);
        const boostedXp = boostAmount(mission.xpReward, missionRewardBonus);
        const boostedRyo = boostAmount(mission.ryoReward, missionRewardBonus);
        const boostedStamina = boostAmount(mission.staminaReward, missionRewardBonus);
        const withCurrencies = applyCurrencyRewards(gainXp(character, boostedXp), mission.currencyRewards);
        const withItems = { ...withCurrencies, inventory: [...withCurrencies.inventory, ...(mission.itemRewards ?? [])] };
        const leveled = grantTerritoryScrolls(withItems, 3);
        updateCharacter(markHuntCompleted({ ...leveled, ryo: leveled.ryo + boostedRyo, stamina: Math.min(leveled.maxStamina, leveled.stamina + boostedStamina) }));
        setAcceptedMissionIds(acceptedMissionIds.filter((id) => id !== mission.id));
        setMissionProgress({ ...missionProgress, [mission.id]: 0 });
        const materialNames = (mission.itemRewards ?? []).map((id) => {
            const found = starterItems.find((i) => i.id === id);
            return found?.name ?? id;
        });
        const matLine = materialNames.length ? ` Materials: ${materialNames.join(", ")}.` : "";
        alert(`${mission.name} complete! +${effectiveCharacterXpGain(character, boostedXp)} XP, +${boostedRyo} ryo, +${boostedStamina} stamina.${matLine}`);
    }

    const missionRanks: MissionRank[] = ["D Rank", "C Rank", "B Rank", "A Rank", "S Rank"];

    return (
        <div className="hunter-board">
            <div className="hunter-board-header">
                <button className="back-btn" onClick={() => setScreen("centralHub")}>← Central</button>
                <h2>🎯 Hunter Guild — Contract Board</h2>
                <span
                    className="hunter-daily-chip"
                    style={{ marginLeft: "auto", fontWeight: 600, color: dailyHuntsCompleted(character) >= DAILY_HUNT_LIMIT ? "#ef4444" : "#fcd34d" }}
                >
                    🎯 Hunts today: {dailyHuntsCompleted(character)}/{DAILY_HUNT_LIMIT}
                </span>
            </div>

            <div className="hunter-rank-banner">
                <div className="hunter-rank-info">
                    <span className="hunter-rank-badge" style={{ background: HUNTER_RANK_COLORS[hunterRank] }}>
                        {HUNTER_RANK_LABELS[hunterRank]}
                    </span>
                    <span className="hunter-rank-sub">
                        {hunterRank < HUNTER_RANKUP.length
                            ? `Rank Up: Turn in ${HUNTER_RANKUP[hunterRank].qty}x ${HUNT_MATERIAL_NAMES[HUNTER_RANKUP[hunterRank].itemId]} (you have ${invCount(HUNTER_RANKUP[hunterRank].itemId)})`
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
                                                <span className="hunt-beast-icon">{beastAi?.icon ?? "🐾"}</span>
                                                <div className="hunt-contract-info">
                                                    <strong>{mission.name}</strong>
                                                    <small>Sector {mission.targetSector} · Lvl {mission.levelReq}+</small>
                                                    <small>{rewardSummary(boostAmount(mission.xpReward, missionRewardBonus), boostAmount(mission.ryoReward, missionRewardBonus), boostAmount(mission.staminaReward, missionRewardBonus), mission.currencyRewards, character)}</small>
                                                    {mission.itemRewards && <small className="hunt-drops">Drops: {mission.itemRewards.map((id) => starterItems.find((i) => i.id === id)?.name ?? id).join(", ")}</small>}
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
