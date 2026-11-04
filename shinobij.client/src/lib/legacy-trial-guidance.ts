/** Active-trial guidance only; qualification formulas and rarity stay hidden. */
export function legacyTrialHint(stat: string): string {
    if (/^(ninjutsu|genjutsu|taijutsu|bukijutsu)(Kills|Damage)$/.test(stat))
        return "Use your permanent specialty in rewarded PvE or eligible player battles. Practice does not count.";
    if (/^(pvp|ranked|sameRank|higherLevel|defensive|sectorDefenses|warPvp)/.test(stat))
        return "Earn verified player-battle results. Defense uses village guard duty; repeated opponents have daily diminishing credit.";
    if (stat === "towerCleanClears") return "Win a Battle Tower floor without any squad knockout. Repeat an accessible floor; Spire is optional.";
    if (stat === "towerParClears") return "Win an accessible Battle Tower floor within its listed round par.";
    if (stat === "towerMechanicClears") return "Win a Battle Tower floor after disrupting a pylon, baiting a charge, or evading a marked strike.";
    if (stat === "towerClears") return "Complete verified Battle Tower victories. Repeated accessible floors count.";
    if (stat === "riftQuests") return "Finish the Rift run, exit it, then claim its quest from the giver. A boss defeat alone is insufficient.";
    if (stat === "gatheringClaims") return "Collect saved gathering finds or successfully finish Fishing and Mining attempts. Failed attempts do not count.";
    if (stat === "craftsCompleted") return "Forge actual items from materials. Currency conversions, purchases and failed crafts do not count.";
    if (stat === "professionActions") return "Complete your profession’s work: heal another player, win eligible Vanguard battles, finish Tamer expeditions, or contribute to Clan Boss operations.";
    if (stat === "clanBossOperations") return "Actively contribute to a victorious Clan Boss operation. Idling in the party does not count.";
    if (stat === "healingDone") return "Restore missing HP in verified battles. Basic Heal and applied recovery effects count; overhealing does not.";
    if (stat === "shieldsApplied") return "Grant shields in verified battles. Each successful shield grant counts.";
    if (stat === "damageBlocked") return "Let shields absorb actual incoming damage in verified battles. Shield expiry is not absorption.";
    if (stat === "petExpeditions") return "Complete and collect server-sealed pet expeditions.";
    if (stat === "petDuelWins") return "Win verified pet battles; human player PvP is not required.";
    if (stat === "cardClashWins") return "Win supported Chronicle Showdown matches. Eligible AI matches count.";
    if (stat === "hollowGateClears") return "Complete a qualifying Hollow Gate extraction; ending an unfinished run does not count.";
    if (stat === "dungeonClears") return "Complete a verified Hidden Dungeon or qualifying Hollow Gate clear.";
    if (stat === "villageDonations") return "Make credited village treasury donations. Existing contribution limits still apply.";
    if (stat === "raidsCompleted" || stat === "warContribution") return "Complete verified village raids, infiltrations or war operations. Claim the result to seal its credit.";
    if (stat === "wandererQuests") return "Finish and claim Wanderer or Emissary quests.";
    if (stat === "sectorDiscoveries") return "Resolve eligible Wanderer encounters; these discoveries can repeat as encounters rotate.";
    if (stat === "hiddenFinds") return "Complete eligible Wanderer ambush gauntlets.";
    if (stat === "huntCompletions") return "Finish and claim Hunter Guild hunts.";
    if (stat === "missionCompletions") return "Finish and claim eligible missions. Academy checklists do not count.";
    if (stat === "eliteKills") return "Defeat credited elites in Hollow Gate, Wanderer ambushes and other supported settlements.";
    return "Complete rewarded, server-verified activity after this trial started, then check progress.";
}
