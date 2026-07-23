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
        launchState: "monitor",
        reason: "Playable PvE goals with tests, but advanced flow should be watched during beta.",
        risk: "Medium; refresh/resume and mobile combat layout are the main player-facing risks.",
        requiredBeforeEnable: "Mobile tower fight smoke and first-clear reward receipt spot-check.",
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
        launchState: "gate",
        reason: "Client-reported boss damage is disabled unless explicitly released server-authoritatively.",
        risk: "High if enabled too early; boss contribution can mint shared rewards.",
        requiredBeforeEnable: "Server-authoritative damage settlement and staging receipt review.",
    },
    {
        system: "Shinobi Chronicle Duel",
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
    weeklyBoss: {
        id: "weekly-boss",
        screen: "weeklyBoss",
        state: "gate",
        title: "Weekly Boss is reward-gated for beta",
        body: "Boss contribution is visible, but public damage reporting stays disabled until server-authoritative settlement is enabled.",
    },
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
        title: "Pet Arena is a soft-launch activity",
        body: "Pet battles are good beta content, but rating, pacing, and mobile readability need launch-week monitoring.",
    },
    petLadder: {
        id: "pet-ladder",
        screen: "petLadder",
        state: "monitor",
        title: "Pet Ladder is monitored beta",
        body: "Use the ladder for ranked pet testing; report stuck offers or confusing rating changes.",
    },
    battleTowers: {
        id: "battle-towers",
        screen: "battleTowers",
        state: "monitor",
        title: "Battle Towers are advanced PvE",
        body: "Squad floors are release-candidate content. Mobile fights and refresh/resume should be verified before promoting them broadly.",
    },
    endlessTower: {
        id: "endless-tower",
        screen: "endlessTower",
        state: "monitor",
        title: "Endless Tower is an advanced climb",
        body: "Good for repeatable beta goals; watch reward pacing, reconnects, and long-session fatigue.",
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

