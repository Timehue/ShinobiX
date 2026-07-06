import type { Character } from "../types/character";
import type { BountyEntry } from "./pvp-bounty";

export type ReputationTone = "neutral" | "gold" | "danger" | "legacy" | "village";

export type ReputationMetric = {
    id: string;
    label: string;
    value: string;
    detail?: string;
    tone?: ReputationTone;
};

export type ReputationBadge = {
    id: string;
    label: string;
    detail?: string;
    tone?: ReputationTone;
};

export type ReputationRivalry = {
    kind: "none" | "npc";
    label: string;
    detail: string;
};

export type ReputationProfile = {
    displayTitle: string;
    subtitle: string;
    identityChips: ReputationBadge[];
    titleBadges: ReputationBadge[];
    metrics: ReputationMetric[];
    rivalry: ReputationRivalry;
};

export function reputationNumber(value: number | undefined): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function formatReputationNumber(value: number | undefined): string {
    return reputationNumber(value).toLocaleString();
}

export function sortBountiesByAmount(entries: BountyEntry[]): BountyEntry[] {
    return [...entries].sort((a, b) => reputationNumber(b.amount) - reputationNumber(a.amount));
}

export function findBountyForTarget(entries: BountyEntry[], target: string): BountyEntry | null {
    const lower = target.trim().toLowerCase();
    if (!lower) return null;
    return entries.find((entry) => entry.target.trim().toLowerCase() === lower) ?? null;
}

export function formatBountyAge(updatedAt: number | undefined, now = Date.now()): string {
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt <= 0) return "recent";
    const minutes = Math.max(0, Math.floor((now - updatedAt) / 60_000));
    if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return hours === 1 ? "1h ago" : `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "1d ago" : `${days}d ago`;
}

export function bountyBackerLabel(entry: BountyEntry): string {
    const count = Array.isArray(entry.contributors) ? entry.contributors.length : 0;
    if (count === 0) return "No listed backers";
    return count === 1 ? "1 backer" : `${count} backers`;
}

export function buildReputationProfile(
    character: Character,
    options: { bloodlineName?: string; bounty?: BountyEntry | null; elements?: string[] } = {},
): ReputationProfile {
    const displayTitle = character.customTitle || character.storyTitle || character.rankTitle;
    const subtitle = [character.village, character.rankTitle, `Lv ${character.level}`].filter(Boolean).join(" / ");
    const bloodline = options.bloodlineName || character.bloodline || "No bloodline";
    const rankedMatches = reputationNumber(character.rankedWins) + reputationNumber(character.rankedLosses);
    const petRankedMatches = reputationNumber(character.petRankedWins) + reputationNumber(character.petRankedLosses);
    const warDamage = reputationNumber(character.lifetimeWarDamage);
    const clanContrib =
        reputationNumber(character.clanBattleContrib) +
        reputationNumber(character.clanEventContrib) +
        reputationNumber(character.clanMissionContrib);
    const achievementCount = character.unlockedAchievements?.length ?? 0;
    const titleCount =
        (character.earnedTitles?.length ?? 0) +
        (character.questTitles?.length ?? 0) +
        (character.serverTitles?.length ?? 0) +
        (character.legacy?.titles?.length ?? 0);

    const identityChips: ReputationBadge[] = [
        { id: "village", label: character.village || "No village", tone: "village" },
        { id: "rank", label: character.rankTitle || "Unranked" },
        { id: "bloodline", label: bloodline, tone: "legacy" },
    ];
    if (character.clan) {
        identityChips.push({
            id: "clan",
            label: character.clan,
            detail: character.clanFounder ? "Founder" : "Clan member",
            tone: "gold",
        });
    }
    if (character.profession) {
        identityChips.push({
            id: "profession",
            label: character.profession,
            detail: character.professionRank ? `Rank ${character.professionRank}` : undefined,
        });
    }
    for (const element of options.elements ?? []) {
        identityChips.push({ id: `element-${element}`, label: element });
    }
    if (character.legacy) {
        identityChips.push({
            id: "legacy",
            label: `Legacy stage ${character.legacy.stage}`,
            detail: character.legacy.titles?.at(-1),
            tone: "legacy",
        });
    }

    const titleBadges: ReputationBadge[] = [];
    const seenTitles = new Set<string>();
    function addTitle(id: string, label: string | undefined, detail?: string, tone: ReputationTone = "gold") {
        const cleaned = label?.trim();
        if (!cleaned || seenTitles.has(cleaned.toLowerCase())) return;
        seenTitles.add(cleaned.toLowerCase());
        titleBadges.push({ id, label: cleaned, detail, tone });
    }
    addTitle("custom", character.customTitle, "Worn title");
    addTitle("story", character.storyTitle, "Story title", "village");
    addTitle("legacy", character.legacy?.titles?.at(-1), "Legacy title", "legacy");
    addTitle("earned", character.earnedTitles?.at(-1), "Achievement title");
    addTitle("quest", character.questTitles?.at(-1), "Quest title", "village");
    addTitle("server", character.serverTitles?.at(-1), "Server title", "legacy");

    const metrics: ReputationMetric[] = [
        {
            id: "ranked",
            label: "Ranked",
            value: rankedMatches > 0 ? formatReputationNumber(character.rankedRating ?? 1000) : "Unranked",
            detail: rankedMatches > 0 ? `${formatReputationNumber(character.rankedWins)}W / ${formatReputationNumber(character.rankedLosses)}L` : "No ranked record",
            tone: rankedMatches > 0 ? "gold" : "neutral",
        },
        {
            id: "pvp",
            label: "PvP Kills",
            value: formatReputationNumber(character.totalPvpKills),
            detail: `${formatReputationNumber(character.monthlyPvpKills)} this month`,
            tone: reputationNumber(character.totalPvpKills) > 0 ? "danger" : "neutral",
        },
        {
            id: "bounty",
            label: "Bounty",
            value: options.bounty ? `${formatReputationNumber(options.bounty.amount)} ryo` : "None",
            detail: options.bounty ? bountyBackerLabel(options.bounty) : "No active public bounty",
            tone: options.bounty ? "danger" : "neutral",
        },
        {
            id: "war",
            label: "Village War",
            value: `${formatReputationNumber(character.warsWon)} wins`,
            detail: `${formatReputationNumber(character.warMvpCount)} MVP / ${formatReputationNumber(warDamage)} damage`,
            tone: reputationNumber(character.warsWon) > 0 || warDamage > 0 ? "village" : "neutral",
        },
        {
            id: "tower",
            label: "Tower",
            value: character.battleTowerBestFloor ? `Floor ${formatReputationNumber(character.battleTowerBestFloor)}` : "Uncleared",
            detail: character.battleTowerSpireWeeklyBest ? `Spire ${formatReputationNumber(character.battleTowerSpireWeeklyBest)} this week` : undefined,
            tone: character.battleTowerBestFloor ? "legacy" : "neutral",
        },
        {
            id: "pets",
            label: "Pets",
            value: `${formatReputationNumber(character.totalPetWins)} wins`,
            detail: petRankedMatches > 0 ? `Pet Elo ${formatReputationNumber(character.petRankedRating ?? 1000)}` : `${character.pets?.length ?? 0} companions`,
        },
        {
            id: "clan",
            label: "Clan Work",
            value: formatReputationNumber(clanContrib),
            detail: character.clan ? character.clan : "No clan",
            tone: clanContrib > 0 ? "gold" : "neutral",
        },
        {
            id: "titles",
            label: "Badges",
            value: formatReputationNumber(achievementCount),
            detail: `${formatReputationNumber(titleCount)} titles recorded`,
            tone: achievementCount > 0 || titleCount > 0 ? "gold" : "neutral",
        },
    ];

    const nemesis = character.wandererNemesis;
    const rivalry: ReputationRivalry = nemesis
        ? {
            kind: "npc",
            label: "Sector nemesis",
            detail: `${nemesis.name} - Lv ${formatReputationNumber(nemesis.level)}, tier ${formatReputationNumber(nemesis.tier)}`,
        }
        : {
            kind: "none",
            label: "No player rivalry recorded",
            detail: "Only real rivalry data appears here.",
        };

    return { displayTitle, subtitle, identityChips, titleBadges, metrics, rivalry };
}
