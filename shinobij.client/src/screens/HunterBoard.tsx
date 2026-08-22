import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { CreatorMission } from "../types/missions";
import type { Screen } from "../types/core";
import { HUNTER_RANKUP, HUNTER_RANK_COLORS, HUNTER_RANK_LABELS, HUNT_MATERIAL_NAMES, HUNT_MIN_RANK, type MissionRank } from "../constants/hunter";
import { FIELD_MISSION_STAT_POINTS } from "../constants/game";
import { rewardSummary, statPointNote } from "../lib/currency";
import { boostAmount, getMissionRewardBonus } from "../lib/village-upgrades";
import { dailyHuntsCompleted, hasDailyHuntSlot, dailyHuntCap } from "../lib/character-progress";
import { postClaimMission, applyServerMissionReward, claimReasonMessage } from "../lib/claim-mission";
import { commitAuthoritativeMissionClaim } from "../lib/versioned-mission-claim";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { starterItems } from "../data/starter-items";
import { builtinHuntMissions } from "../data/missions";
import { beastPortrait, huntMaterialIcon, hunterRankBadge, HUNTER_GUILD_BACKDROP, APEX_CONTRACT_BANNER } from "../data/hunter-art";
import { huntTrailSector } from "../lib/hunt-trail";
import { postWorldHunt, type WorldHuntTrailView } from "../lib/world-hunt-api";
import { setSectorReopen } from "../lib/sector-return";
import {
    APEX_FATE_SHARDS,
    APEX_RYO,
    APEX_STAT_POINTS,
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
import { requestAiFight } from "../lib/ai-fight-request";
import { gameConfirm } from "../components/GameAlert";
import { playerSlug } from "../lib/utils";
import { GiDragonHead } from "react-icons/gi";
import { CentralDestinationHeader } from "../components/CentralDestinationHeader";

export function HunterBoard({
    character,
    updateCharacter,
    onVersionedCharacter,
    onServerVersion,
    creatorAis,
    acceptedMissionIds,
    setAcceptedMissionIds,
    missionProgress,
    setMissionProgress,
    setScreen,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    onVersionedCharacter: VersionedCharacterCommit;
    onServerVersion: (version: unknown) => boolean;
    creatorAis: CreatorAi[];
    acceptedMissionIds: string[];
    setAcceptedMissionIds: React.Dispatch<React.SetStateAction<string[]>>;
    missionProgress: Record<string, number>;
    setMissionProgress: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    setScreen: (s: Screen) => void;
}) {
    const hunterRank = character.hunterRank ?? 0;
    const huntCap = dailyHuntCap(character);
    const missionRewardBonus = getMissionRewardBonus(character) + getActiveAuraSphereBonuses(character).missionRewardPercent;
    const [authoritativeHuntStates, setAuthoritativeHuntStates] = useState<Record<string, WorldHuntTrailView>>({});
    const huntClaimInFlight = useRef(false);
    const [claimingHuntId, setClaimingHuntId] = useState<string | null>(null);
    const acceptedHuntKey = builtinHuntMissions
        .filter((mission) => acceptedMissionIds.includes(mission.id))
        .map((mission) => mission.id)
        .sort()
        .join("|");

    // The Guild can be opened directly after a refresh, including while a pack
    // is pending at the sign's decision sector. Reconcile the same durable state
    // the World Map uses so Go To Sector and Claim never depend on a stale local
    // progress hash.
    useEffect(() => {
        let cancelled = false;
        const missionIds = acceptedHuntKey ? acceptedHuntKey.split("|") : [];
        void (async () => {
            const next: Record<string, WorldHuntTrailView> = {};
            for (const missionId of missionIds) {
                const result = await postWorldHunt({ playerName: character.name, action: "state", missionId });
                if (cancelled || !result.ok) continue;
                if (result.character) {
                    if (!onVersionedCharacter(result.character, result._saveVersion)) continue;
                } else if (!onServerVersion(result._saveVersion)) {
                    continue;
                }
                if (result.acceptedMissionIds) setAcceptedMissionIds(result.acceptedMissionIds);
                if (result.state) next[missionId] = result.state;
                setMissionProgress((current) => {
                    const progress = result.missionProgress ? { ...result.missionProgress } : { ...current };
                    const mission = builtinHuntMissions.find((entry) => entry.id === missionId);
                    if (mission && (result.state?.claimable || result.state?.targetDefeated)) {
                        progress[missionId] = mission.exploreCount;
                    }
                    return progress;
                });
            }
            if (!cancelled) setAuthoritativeHuntStates(next);
        })();
        return () => { cancelled = true; };
    }, [acceptedHuntKey, character.name, onServerVersion, onVersionedCharacter, setAcceptedMissionIds, setMissionProgress]);

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
            const result = await rankUpHunterServer(character.name);
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            alert(`Hunter Rank advanced! You are now a ${HUNTER_RANK_LABELS[hunterRank + 1]}.`);
        } catch (error) {
            alert(error instanceof Error ? error.message : "Hunter Rank advancement failed.");
        }
    }

    async function acceptHunt(mission: CreatorMission) {
        if (!requireServerSettlement("fieldHuntMissions")) return;
        if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`);
        if ((HUNT_MIN_RANK[mission.rank] ?? 0) > hunterRank) return alert(`Requires Hunter Rank: ${HUNTER_RANK_LABELS[HUNT_MIN_RANK[mission.rank] ?? 0]}.`);
        // Idempotent on the server. Calling accept for an already-visible legacy
        // contract lets rollout migration materialize its authoritative trail.
        const result = await postWorldHunt({ playerName: character.name, action: "accept", missionId: mission.id });
        if (!result.ok) {
            // Claimed-today/stale cross-device cards return a cleaned snapshot
            // even with a conflict status. Adopt it before explaining why this
            // exact contract cannot be reaccepted.
            if (result.character) {
                if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            } else if (result._saveVersion !== undefined && !onServerVersion(result._saveVersion)) return;
            if (result.acceptedMissionIds) setAcceptedMissionIds(result.acceptedMissionIds);
            if (result.missionProgress) setMissionProgress(result.missionProgress);
            setAuthoritativeHuntStates((current) => {
                const next = { ...current };
                if (result.state) next[mission.id] = result.state;
                else delete next[mission.id];
                return next;
            });
            return alert(result.error ?? "The Guild could not seal this contract. Try again.");
        }
        if (result.character) {
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
        } else if (!onServerVersion(result._saveVersion)) return;
        setAcceptedMissionIds(result.acceptedMissionIds ?? ((prev) => prev.includes(mission.id) ? prev : [...prev, mission.id]));
        setMissionProgress(result.missionProgress ?? ((prev) => ({ ...prev, [mission.id]: result.progress ?? 0 })));
        if (result.reason === "already-claimed-today") {
            setAuthoritativeHuntStates((current) => {
                const next = { ...current };
                delete next[mission.id];
                return next;
            });
            return alert("That hunt was already claimed today. The Guild refreshed your ledger instead of accepting it again.");
        }
        if (!result.state) return alert("The Guild did not issue an active trail. Reopen the board before hunting this target.");
        setAuthoritativeHuntStates((current) => ({ ...current, [mission.id]: result.state! }));
        // First lead sits where the world-map paw marker starts (the trail roams
        // inward toward targetSector), so point the player there, not at the beast's
        // final ground.
        const firstLead = result.state?.sector ?? result.nextSector ?? huntTrailSector(mission, result.progress ?? result.state?.progress ?? 0, playerSlug(character.name));
        alert(`${mission.name} accepted. Your first lead is in Sector ${firstLead} — head there and use Hunt to pick up the trail, then follow the paw marker to the beast.`);
    }

    function materialNames(itemIds: string[]): string[] {
        return itemIds.map((id) => starterItems.find((i) => i.id === id)?.name ?? id);
    }

    function applySuccessfulMissionClaim(result: Extract<NonNullable<Awaited<ReturnType<typeof postClaimMission>>>, { applied: true }>): boolean {
        const authoritativeCommit = commitAuthoritativeMissionClaim(result, onVersionedCharacter);
        if (authoritativeCommit !== null) return authoritativeCommit;
        if (!onServerVersion(result._saveVersion)) return false;
        updateCharacter((prev) => (prev ? applyServerMissionReward(prev, result, gainXp) : prev));
        return true;
    }

    async function claimHunt(mission: CreatorMission) {
        if (huntClaimInFlight.current) return;
        huntClaimInFlight.current = true;
        setClaimingHuntId(mission.id);
        try {
            await claimHuntOnce(mission);
        } finally {
            huntClaimInFlight.current = false;
            setClaimingHuntId(null);
        }
    }

    async function claimHuntOnce(mission: CreatorMission) {
        if (!requireServerSettlement("fieldHuntMissions")) return;
        let progress = missionProgress[mission.id] ?? 0;
        // A target WIN receipt may have committed just before a refresh while
        // the local presentation mirror was still required-1. Probe the durable
        // trail before refusing the normal explicit turn-in.
        if (progress < mission.exploreCount) {
            const trail = await postWorldHunt({ playerName: character.name, action: "state", missionId: mission.id });
            if (trail.ok) {
                if (trail.character) {
                    if (!onVersionedCharacter(trail.character, trail._saveVersion)) return;
                } else if (!onServerVersion(trail._saveVersion)) {
                    return;
                }
                if (trail.acceptedMissionIds) setAcceptedMissionIds(trail.acceptedMissionIds);
                if (trail.state) setAuthoritativeHuntStates((current) => ({ ...current, [mission.id]: trail.state! }));
                progress = trail.state?.claimable || trail.state?.targetDefeated
                    ? mission.exploreCount
                    : trail.missionProgress?.[mission.id] ?? trail.state?.progress ?? progress;
                setMissionProgress((current) => ({
                    ...(trail.missionProgress ?? current),
                    [mission.id]: progress,
                }));
            }
        }
        if (progress < mission.exploreCount) return alert(`Hunt the beast ${mission.exploreCount - progress} more time(s) in Sector ${mission.targetSector}.`);
        if (!hasDailyHuntSlot(character)) return alert(`Daily hunt limit reached (${huntCap}/${huntCap}). Resets at midnight UTC.`);

        // Server-authoritative for built-in hunts (audit M-1): the server resolves
        // the reward from its trusted catalog, enforces the daily hunt cap, and
        // grants the material drops so none of it can be minted client-side.
        // Unknown/creator-authored hunt ids are rejected instead of paid locally.
        const result = await postClaimMission(character.name, "hunt", mission.id);
        if (result === null) return alert("Could not reach the server. Try again.");
        if (result.applied === true) {
            if (!applySuccessfulMissionClaim(result)) return;
            setAcceptedMissionIds((prev) => prev.filter((id) => id !== mission.id));
            setMissionProgress((prev) => ({ ...prev, [mission.id]: 0 }));
            alert(`${mission.name} complete! ${statPointNote(result.reward.statPoints)}${rewardSummary(result.reward.ryo, result.reward.stamina, result.reward.currency, character, { territoryScrolls: result.reward.territoryScrolls, items: materialNames(result.reward.items ?? []) })}.`);
            return;
        }
        if (result.applied === false) {
            if (result.reason === "already-claimed-today" || result.reason === "already-claimed") {
                // Server already paid this hunt today — reconcile the local board so a
                // desynced client stops showing a dead Claim button on a done contract.
                const trail = await postWorldHunt({ playerName: character.name, action: "state", missionId: mission.id });
                if (!trail.ok) {
                    return alert("The reward is paid, but the Guild is still syncing its receipt. Try Claim again to reconcile it.");
                }
                if (trail.character) {
                    if (!onVersionedCharacter(trail.character, trail._saveVersion)) return;
                } else if (!onServerVersion(trail._saveVersion)) {
                    return;
                }
                if (trail.acceptedMissionIds) setAcceptedMissionIds(trail.acceptedMissionIds);
                if (trail.missionProgress) setMissionProgress(trail.missionProgress);
                setAuthoritativeHuntStates((current) => {
                    const next = { ...current };
                    if (trail.state) next[mission.id] = trail.state;
                    else delete next[mission.id];
                    return next;
                });
                return alert(claimReasonMessage(result.reason, result));
            }
            if (
                result.reason === "missing-hunt-kill-receipt" ||
                result.reason === "missing-progress-receipt" ||
                result.reason === "missing-server-evidence"
            ) {
                // Self-heal the stale-claim trap. The hunt reward is gated on the
                // server-verified kill (report-ai-fight). If that receipt never
                // landed — the fight token 409'd, or its POST was dropped — local
                // progress still hit `required`, so activeHuntTrails dropped the
                // trail and the Claim button stayed dead forever. Rolling back to
                // required-1 relights the trail on the beast's ground so the player
                // can re-fight it and re-earn the kill receipt. (missing-server-
                // evidence can no longer fire for hunts on a current server, but a
                // rolling deploy might still return it, so we heal it here too.)
                setMissionProgress((prev) => ({
                    ...prev,
                    [mission.id]: Math.max(0, (mission.exploreCount ?? 1) - 1),
                }));
                return alert("The Guild hasn't logged your kill for this contract yet. The trail is hot again — return to the beast's ground and bring it down once more to claim.");
            }
            return alert(claimReasonMessage(result.reason, result));
        }
    }

    /** Drop an accepted contract through the authoritative trail ledger. */
    // gameConfirm, not the bare global confirm(): the native dialog renders raw browser
    // chrome over the game and skips the focus trap / scroll lock the themed one has.
    // Marked danger — abandoning discards tracking progress.
    async function abandonHunt(mission: CreatorMission) {
        if (!await gameConfirm(`Abandon "${mission.name}"? You'll lose your tracking progress on this contract.`, { title: "Abandon contract", confirmLabel: "Abandon", danger: true })) return;
        const result = await postWorldHunt({ playerName: character.name, action: "abandon", missionId: mission.id });
        if (!result.ok) return alert(result.error ?? "The Guild could not release this contract. Try again.");
        if (result.character) {
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
        } else if (!onServerVersion(result._saveVersion)) return;
        setAcceptedMissionIds(result.acceptedMissionIds ?? ((prev) => prev.filter((id) => id !== mission.id)));
        setMissionProgress(result.missionProgress ?? ((prev) => ({ ...prev, [mission.id]: result.progress ?? 0 })));
    }

    // ── Apex Contract ───────────────────────────────────────────────────────
    const apexWeek = isoWeekKey(new Date());

    /** Straight to the fight: the Apex is already found, there is no trail. */
    function faceApex() {
        if (!requireServerSettlement("fieldHuntMissions")) return;
        if (!canTakeApex(character)) return;
        // apex-ai-* profiles are real builtins (lib/combat-ai.ts), so both the
        // Arena and the server's profile catalog resolve them by id with no
        // registration step — and, unlike a tracked hunt, the Apex has no trail,
        // so nothing about the encounter is modified client-side. That makes it
        // safe to seal.
        //
        // `raidAi` is sealed before combat so report-ai-fight can write the Apex
        // kill receipt. The board never stages a local Arena fallback.
        const apexAiId = apexBeastForWeek(apexWeek).apexAiId;
        requestAiFight({
            opponentId: apexAiId,
            opponentLevel: character.level,
            battleKind: "raidAi",
            opponentName: apexBeastForWeek(apexWeek).name,
        });
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
            if (!applySuccessfulMissionClaim(result)) return;
            alert(`Apex Contract complete! ${statPointNote(result.reward.statPoints)}${rewardSummary(result.reward.ryo, result.reward.stamina, result.reward.currency, character, { territoryScrolls: result.reward.territoryScrolls, items: materialNames(result.reward.items ?? []) })}.`);
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
            <CentralDestinationHeader
                backLabel="Central"
                eyebrow="The Thousand Gates · Tracker Command"
                icon={<GiDragonHead />}
                onBack={() => setScreen("centralHub")}
                statusLabel="Daily contracts"
                statusValue={`${dailyHuntsCompleted(character)} / ${huntCap}`}
                subtitle="Read the trail, prepare the right loadout, and turn dangerous quarry into guild standing."
                title="Hunter Guild"
                tone="azure"
            />

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
                                {APEX_RYO.toLocaleString()} ryo · {APEX_FATE_SHARDS} Fate Shards · +{APEX_STAT_POINTS} Stat Pts
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
                                    const authoritative = authoritativeHuntStates[mission.id];
                                    const progress = authoritative?.claimable || authoritative?.targetDefeated
                                        ? mission.exploreCount
                                        : authoritative?.progress ?? missionProgress[mission.id] ?? 0;
                                    const complete = authoritative?.claimable === true
                                        || authoritative?.targetDefeated === true
                                        || progress >= mission.exploreCount;
                                    // The trail roams inward toward the beast, so the current lead is
                                    // NOT the final targetSector until the last track. Point "Go To
                                    // Sector" at the same sector the world-map paw marker sits on
                                    // (huntTrailSector), not the destination — otherwise the button
                                    // sends the player to an empty sector with no active trail.
                                    const leadSector = authoritative?.sector ?? huntTrailSector(mission, progress, playerSlug(character.name));
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
                                                    <small>+{FIELD_MISSION_STAT_POINTS} Stat Pts / {rewardSummary(boostAmount(mission.ryoReward, missionRewardBonus), boostAmount(mission.staminaReward, missionRewardBonus), mission.currencyRewards, character)}</small>
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
                                                    : <>
                                                        {complete
                                                            ? <button disabled={claimingHuntId !== null} onClick={() => { void claimHunt(mission); }}>{claimingHuntId === mission.id ? "Claimingâ€¦" : "Claim Reward"}</button>
                                                            : <button onClick={() => { setSectorReopen(leadSector); setScreen("worldMap"); }}>Go To Sector {leadSector}</button>
                                                        }
                                                        <button className="danger-button" disabled={claimingHuntId !== null} onClick={() => void abandonHunt(mission)}>Give Up</button>
                                                    </>
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
