import type { Screen } from "../types/core";

export type LaunchState = "ready" | "monitor" | "gate" | "desktop";

export interface ReleaseSystemRow {
    system: string;
    launchState: LaunchState;
    reason: string;
    risk: string;
    requiredBeforeEnable: string;
}

export interface PublicBetaNotice {
    id: string;
    screen: Screen;
    state: LaunchState;
    title: string;
    body: string;
}

export const RELEASE_SYSTEM_MATRIX: ReleaseSystemRow[] = [
    {
        system: "Core onboarding, Training, Missions, Inventory, Bank, Hospital, Shop",
        launchState: "ready",
        reason: "Covered by the Academy path, first-step goals, and server-side reward hardening.",
        risk: "Low; watch save routing and first-session confusion.",
        requiredBeforeEnable: "Live smoke: fresh account through first mission claim.",
    },
    {
        system: "PvP and Ranked PvP",
        launchState: "monitor",
        reason: "Server sessions, battle receipts, anti-farm checks, and ranked reward paths exist.",
        risk: "Medium; disconnections, mobile readability, and alt-farm edge cases need launch telemetry.",
        requiredBeforeEnable: "Manual staging PvP on desktop and mobile plus battle receipt review.",
    },
    {
        system: "Battle Towers and Endless Tower",
        launchState: "ready",
        reason: "Server-issued run tokens, AI-fight proofs, first-clear receipts, and reconnect state protect both tower modes.",
        risk: "Low to medium; continue watching long-session balance and mobile combat layout.",
        requiredBeforeEnable: "Keep endpoint, resume, mobile layout, and reward-receipt checks green.",
    },
    {
        system: "Clan, Clan Boss, Village War, Sector War",
        launchState: "gate",
        reason: "Social/economy systems can shape the live world and should soft-launch with staff watching.",
        risk: "High; duplicated rewards, unclear war state, and low-population imbalance.",
        requiredBeforeEnable: "Admin runbook, war reward receipt audit, and live operator coverage.",
    },
    {
        system: "Weekly Boss",
        launchState: "ready",
        reason: "Fight reservations, signed damage events, rate limits, and idempotent reward distribution are server-authoritative.",
        risk: "Medium; shared-event balance and participation spikes still deserve operational monitoring.",
        requiredBeforeEnable: "Keep signed-damage, distribution, and replay-protection tests green.",
    },
    {
        system: "Shinobi Chronicle Showdown",
        launchState: "ready",
        reason: "AI, free-play PvP, Clan War and Sector War share one server-authoritative rules engine with validated 40-card decks.",
        risk: "Low to medium; balance and reconnect behavior should still be observed after release.",
        requiredBeforeEnable: "Automated engine, endpoint, asset and production-build gates must remain green.",
    },
    {
        system: "Pet Arena, Pet Ladder",
        launchState: "monitor",
        reason: "Contained side activities with existing rate limits and battle state.",
        risk: "Medium; clarity and balance are more likely than save-loss issues.",
        requiredBeforeEnable: "Small-population beta and logs for stuck matches.",
    },
    {
        system: "Hollow Gate and late-game legacy goals",
        launchState: "desktop",
        reason: "Late-game dungeon flow is complex and should not be a first-week mobile promise.",
        risk: "Medium; long-run state, no-retreat rules, and dense UI.",
        requiredBeforeEnable: "Desktop-first beta label, then mobile layout verification.",
    },
    {
        system: "Bloodline Maker and AI image generation",
        launchState: "gate",
        reason: "Player-created content needs moderation; AI image generation also carries spend risk.",
        risk: "High without moderation and budget monitoring.",
        requiredBeforeEnable: "Keep AI generation admin-only unless ENABLE_PLAYER_AI_IMAGE_GENERATION=1 is intentionally set.",
    },
    {
        system: "Admin moderation and economy diagnostics",
        launchState: "ready",
        reason: "Admin auth remains protected and diagnostics are available for launch operations.",
        risk: "Medium; dangerous actions require disciplined operator process.",
        requiredBeforeEnable: "Admin smoke with real staging credentials.",
    },
];

const SCREEN_NOTICES: Partial<Record<Screen, PublicBetaNotice>> = {
    villageWar: {
        id: "village-war",
        screen: "villageWar",
        state: "gate",
        title: "Village War is a staffed beta system",
        body: "War can reshape rewards and world state. Use it during public beta only when admins can monitor receipts and resolve disputes.",
    },
    villageWarMap: {
        id: "sector-war-map",
        screen: "villageWarMap",
        state: "gate",
        title: "Sector War is soft-launched",
        body: "Sector declarations, terrain, mercenaries, and war supply should be monitored before inviting all players into them.",
    },
    sectorPet: {
        id: "sector-pet",
        screen: "sectorPet",
        state: "monitor",
        title: "Sector Pet Battle is in beta",
        body: "Pet sector fights are safe to test, but beta rewards and war impact should be watched by staff.",
    },
    cardClashFreePlay: {
        id: "card-free-play",
        screen: "cardClashFreePlay",
        state: "monitor",
        title: "Card duel in progress",
        body: "This duel locks navigation while unresolved. Finish or forfeit cleanly so the match state can settle.",
    },
    petArena: {
        id: "pet-arena",
        screen: "petArena",
        state: "monitor",
        title: "Pet Arena live-service monitoring",
        body: "Matches and ratings are live. Operations monitors pacing, disconnects, and mobile readability.",
    },
    petLadder: {
        id: "pet-ladder",
        screen: "petLadder",
        state: "monitor",
        title: "Pet Ladder live-service monitoring",
        body: "The ranked ladder is live. Stuck offers and unexpected rating changes are tracked as service incidents.",
    },
    battleTowers: {
        id: "battle-towers",
        screen: "battleTowers",
        state: "monitor",
        title: "Battle Towers live-service monitoring",
        body: "Squad floors and first-clear rewards are live. Operations monitors mobile fights, reconnects, and reward receipts.",
    },
    hollowGateShrine: {
        id: "hollow-gate",
        screen: "hollowGateShrine",
        state: "desktop",
        title: "Hollow Gate is desktop-first beta",
        body: "This late-game run has dense rules and no-retreat pressure. Treat mobile as experimental until the staging checklist passes.",
    },
    hollowGateTiles: {
        id: "hollow-gate-tiles",
        screen: "hollowGateTiles",
        state: "desktop",
        title: "Hollow Gate minigames are desktop-first",
        body: "Finish the tile objective before navigating away. Mobile layout should be rechecked before broad promotion.",
    },
    bloodlineMaker: {
        id: "bloodline-maker",
        screen: "bloodlineMaker",
        state: "gate",
        title: "Bloodline Maker needs moderation coverage",
        body: "Player-created bloodlines are powerful identity tools. AI image generation is admin-only unless the release flag is intentionally enabled.",
    },
};

export function releaseNoticeForScreen(screen: Screen): PublicBetaNotice | null {
    return SCREEN_NOTICES[screen] ?? null;
}

