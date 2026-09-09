/*
 * Which game a sector attack opens.
 *
 * §17.2 of docs/village-war-map-economy-plan.md ("Per-type attack-button
 * wiring") says a sector's win-condition decides what its Attack button
 * launches: Combat → a PvP shinobi fight, Card → a Chronicle Showdown, Pet → a
 * pet duel. Only Combat was ever wired. Attacking someone standing in a Card or
 * Pet sector opened an ordinary shinobi fight, and the server answered the
 * registration with a 200 no-op (api/village/sector-war.ts doAttack, `reason:
 * 'win-condition'`), so the fight scored nothing for the war and nobody was
 * told. This module is the missing branch.
 *
 * It is deliberately pure and IO-free so WorldMap can stay inside its line
 * ratchet and so the participant rule can be tested without a browser. The rule
 * below MIRRORS the server's: api/village/sector-card.ts and
 * api/village/sector-pet.ts both refuse a joiner whose village is neither side
 * of the contest (403), so a client that routed anyone else into those screens
 * would only be sending them somewhere to be rejected.
 *
 * Note on semantics: a Card/Pet contest is ONE session per war
 * (`sector-card:<contestId>`), attacker-opens / defender-answers — not a private
 * duel between the two specific players. So "attack that person" resolves to
 * "take your side's seat at this sector's table". That is the session model the
 * server has, and matching it is what keeps this a routing fix rather than a
 * rewrite of the contest engine.
 */
import type { Screen } from "../types/core";

export type SectorWarWinCondition = "combat" | "card" | "pet";

/** The active contest on a sector as /api/sector/merc-roam projects it. */
export type SectorWarContestView = {
    id: string;
    sector: number;
    winCondition: SectorWarWinCondition;
    attackerVillage: string;
    defenderVillage: string;
    endsAt: number;
    /** Server verdict: may THIS viewer fight the sector's garrison right now?
     *  Decided in api/sector/merc-roam.ts, never re-derived here — the rule reads
     *  `appliedBattles`, which no client projection carries, and a second
     *  implementation would only drift from the one the endpoints enforce. */
    garrisonReady?: boolean;
};

/** A contest this viewer may act on: always Card or Pet, never Combat. */
export type SectorWarContestEntryView = SectorWarContestView & { winCondition: "card" | "pet" };

export type SectorEngagement =
    | { kind: "combat" }
    | { kind: "contest"; winCondition: "card" | "pet"; contestId: string; screen: Screen; stashKey: string };

/** sessionStorage handoff each contest screen already reads on mount. */
const CONTEST_ROUTE: Record<"card" | "pet", { screen: Screen; stashKey: string }> = {
    card: { screen: "sectorCard", stashKey: "sectorWarCard.v1" },
    pet: { screen: "sectorPet", stashKey: "sectorWarPet.v1" },
};

const COMBAT: SectorEngagement = { kind: "combat" };

/**
 * What an attack in this sector should open, given the contest running on it.
 *
 * Falls back to Combat — today's behaviour — for every case the contest does not
 * cover, so an unreadable/absent contest can never strand a player on a screen
 * the server would refuse them. `myVillage` and `targetVillage` must be the two
 * sides of the contest (in either order): a Leaf player attacking a Sand player
 * inside a Leaf-vs-Mist war is ordinary world PvP, not a war battle.
 */
export function sectorEngagementFor(args: {
    contest: SectorWarContestView | null | undefined;
    sector: number;
    myVillage: string | null | undefined;
    targetVillage: string | null | undefined;
    now: number;
}): SectorEngagement {
    const contest = args.contest;
    if (!contest) return COMBAT;
    if (contest.winCondition === "combat") return COMBAT;
    if (contest.sector !== args.sector) return COMBAT;
    // The projection only ships active contests, but a stale poll can outlive the
    // 72h window between renders; never route into a war that has already closed.
    if (!(args.now < Number(contest.endsAt))) return COMBAT;

    const mine = String(args.myVillage ?? "").trim();
    const theirs = String(args.targetVillage ?? "").trim();
    if (!mine || !theirs || mine === theirs) return COMBAT;
    const sides = [contest.attackerVillage, contest.defenderVillage];
    if (!sides.includes(mine) || !sides.includes(theirs)) return COMBAT;

    const route = CONTEST_ROUTE[contest.winCondition];
    return { kind: "contest", winCondition: contest.winCondition, contestId: contest.id, screen: route.screen, stashKey: route.stashKey };
}

/**
 * Whether the viewer may open this sector's contest table with no opponent
 * standing next to them.
 *
 * A Card/Pet contest never needed co-location: the attacker opens the table and
 * the defender answers it whenever they log in. Before this, the ONLY way in was
 * a button on the War Map menu screen — which both hid the war from the sector
 * it is being fought over and broke "menus never move you". This is the sector's
 * own entry to the same table.
 */
export function sectorContestEntryFor(
    contest: SectorWarContestView | null | undefined,
    sector: number,
    myVillage: string | null | undefined,
    now: number,
): SectorEngagement {
    const mine = viewerSectorContest(contest, sector, myVillage, now);
    if (!mine) return COMBAT;
    const route = CONTEST_ROUTE[mine.winCondition];
    return { kind: "contest", winCondition: mine.winCondition, contestId: mine.id, screen: route.screen, stashKey: route.stashKey };
}

/**
 * The live Card/Pet contest on this sector AS THIS VIEWER MAY ACT ON IT, or null.
 *
 * Returns null for a bystander village, because their attack correctly stays a
 * plain shinobi fight — they are not in this war, so there is nothing to explain
 * to them and no table for them to take a seat at. Returning the narrowed value
 * once lets the command panel stay presentation-only: it renders whatever it is
 * handed instead of deciding who is a participant.
 */
export function viewerSectorContest(
    contest: SectorWarContestView | null | undefined,
    sector: number,
    myVillage: string | null | undefined,
    now: number,
): SectorWarContestEntryView | null {
    if (!contest || contest.winCondition === "combat") return null;
    if (contest.sector !== sector) return null;
    if (!(now < Number(contest.endsAt))) return null;
    const mine = String(myVillage ?? "").trim();
    if (!mine || (mine !== contest.attackerVillage && mine !== contest.defenderVillage)) return null;
    return contest as SectorWarContestEntryView;
}

/**
 * Whether to offer the garrison button.
 *
 * A Card/Pet contest scores nothing until a defender takes the other seat, so a
 * village that never logs in used to run the 72h clock out at 0-0 and keep the
 * sector on settlement's tie-to-the-defender rule. Once the sector has been
 * quiet long enough, the attacking side fights the defence's sealed deck/team
 * instead of waiting forever.
 *
 * The verdict is the server's (see SectorWarContestView.garrisonReady): the rule
 * spans an idle window, a re-form window and attacker-side-only, and one of
 * those reads state no client projection carries. Defender-side never sees the
 * button — the garrison exists precisely because the DEFENCE is absent.
 */
export function sectorContestGarrisonReady(
    contest: SectorWarContestEntryView | null | undefined,
    now: number,
): boolean {
    if (!contest) return false;
    if (!(now < Number(contest.endsAt))) return false;
    return contest.garrisonReady === true;
}

/** Button/notice wording for a contest entry. Pure so the panel stays dumb. */
export function sectorContestLabel(winCondition: "card" | "pet"): string {
    return winCondition === "card" ? "Card Battle" : "Pet Battle";
}

/** Where a contest screen's Back goes, kept in a SIBLING key. It cannot live in
 *  the contest stash itself: ClanWarTileCardDuel posts `{ action, ...stash }`, so
 *  anything added there is sent to the server as request body. The stash keeps
 *  the exact `{ sectorWarId }` shape the War Map has always written. */
export function contestBackKey(stashKey: string): string {
    return `${stashKey}:from`;
}

/** The screen a contest table should return to, or the War Map when the entry
 *  did not record one (which is what the War Map's own launch does). */
export function stashedContestBackScreen(stashKey: string, fallback: Screen): Screen {
    try {
        return sessionStorage.getItem(contestBackKey(stashKey)) === "worldMap" ? "worldMap" : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Stash the contest id exactly the way the War Map already does and hand back
 * the screen to route to, recording the return target alongside it so a table
 * entered from the world map goes back to the world map, not a menu.
 *
 * `garrison` opens the sector's garrison instead of the live table, and DOES go
 * in the stash: the Chronicle screen posts `{ action, ...stash }`, and unlike
 * the return target this is a field the server reads. It is a mode selector, not
 * a permission -- api/village/sector-card.ts and sector-pet.ts re-derive the
 * contest type, the attacking village and the idle unlock from server state
 * before either will mint a garrison battle.
 *
 * Returns null for a Combat engagement so the caller falls through to the
 * existing PvP path untouched.
 */
export function beginSectorContest(
    engagement: SectorEngagement,
    backScreen: Screen,
    opts: { garrison?: boolean } = {},
): Screen | null {
    if (engagement.kind !== "contest") return null;
    try {
        sessionStorage.setItem(engagement.stashKey, JSON.stringify({
            sectorWarId: engagement.contestId,
            ...(opts.garrison ? { garrison: true } : {}),
        }));
        sessionStorage.setItem(contestBackKey(engagement.stashKey), backScreen);
    } catch {
        /* storage disabled — the screen renders its own "context was lost" card */
    }
    return engagement.screen;
}

/** Whether the contest screen was opened as a garrison assault. */
export function stashedContestIsGarrison(stashKey: string): boolean {
    try {
        return (JSON.parse(sessionStorage.getItem(stashKey) ?? "{}") as { garrison?: unknown }).garrison === true;
    } catch {
        return false;
    }
}
