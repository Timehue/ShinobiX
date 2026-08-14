/*
 * Pure helpers for the Tactical Arena player-vs-player challenge. Both clients
 * resolve the SAME embedded teams + seed so runPetArenaMatch stays
 * deterministic. Kept out of App.tsx (line-budget ratchet) — App holds only the
 * React glue (state, notify, screen routing); PetArena drives the pickers.
 */
import type { Pet } from "../types/pet";
import type {
    WfBuildPackage, WfBuyPolicy, WfCoachOrder, WfCounterstrike, WfDoctrine,
    WfObjectiveTechnique, WfOpeningDeployment, WfStance,
} from "./pet-warfront-sim";

export type ArenaTeam = "blue" | "red";
export type SharedWfBuyPolicy = Exclude<WfBuyPolicy, "off">;
export type WarfrontAuthoredSetup = {
    deployment: WfOpeningDeployment;
    buildPackage: WfBuildPackage;
    coachOrder: WfCoachOrder;
    objectiveTechnique: WfObjectiveTechnique;
    counterstrike: WfCounterstrike;
};
export type WarfrontSetup = {
    stance: WfStance;
    doctrine: WfDoctrine;
    buyPolicy: SharedWfBuyPolicy;
} & WarfrontAuthoredSetup;
export type VersionedWarfrontSetup = WarfrontSetup & { version: 1 };

export const DEFAULT_SHARED_WARFRONT_SETUP: WarfrontSetup = {
    stance: "balanced",
    doctrine: "warden-pact",
    buyPolicy: "balanced",
    deployment: ["top", "mid", "bottom", "flex"],
    buildPackage: "escort-rite",
    coachOrder: "trade",
    objectiveTechnique: "secure",
    counterstrike: "cross-map",
};

export const WF_SHARED_BUY_POLICIES = new Set<SharedWfBuyPolicy>(["balanced", "offense", "defense"]);
export const WF_SETUP_STANCES = new Set<WfStance>(["balanced", "siege", "jungle", "headhunt", "turtle"]);
export const WF_SETUP_DOCTRINES = new Set<WfDoctrine>(["none", "vanguard", "bulwark", "zealot", "warden-pact"]);
export const WF_DEPLOYMENT_LANES = new Set(["top", "mid", "bottom", "flex"] as const);
export const WF_BUILD_PACKAGES = new Set<WfBuildPackage>(["hold-line", "blood-hunt", "escort-rite"]);
export const WF_COACH_ORDERS = new Set<WfCoachOrder>(["contest", "trade", "ambush"]);
export const WF_OBJECTIVE_TECHNIQUES = new Set<WfObjectiveTechnique>(["secure", "hijack", "zone"]);
export const WF_COUNTERSTRIKES = new Set<WfCounterstrike>(["fortify", "cross-map", "bounty-hunt"]);
const WF_SETUP_FIELDS = new Set([
    "stance", "doctrine", "buyPolicy", "deployment", "buildPackage",
    "coachOrder", "objectiveTechnique", "counterstrike",
]);

function strictDeployment(value: unknown): WfOpeningDeployment | null {
    if (!Array.isArray(value) || value.length !== 4 || new Set(value).size !== 4
        || !value.every((lane) => WF_DEPLOYMENT_LANES.has(lane as "top" | "mid" | "bottom" | "flex"))) {
        return null;
    }
    return [...value] as unknown as WfOpeningDeployment;
}
const sealedDeployment = (value: unknown): WfOpeningDeployment =>
    strictDeployment(value) ?? [...DEFAULT_SHARED_WARFRONT_SETUP.deployment];

/** Shared PvP/co-op matches cannot pause one client for a Manual Council. This
 * converts the local preference into the complete deterministic setup sealed in
 * the challenge payload. */
export function sharedWarfrontSetup(
    stance: WfStance,
    doctrine: WfDoctrine,
    buyPolicy: WfBuyPolicy,
    authored: Partial<WarfrontAuthoredSetup> = DEFAULT_SHARED_WARFRONT_SETUP,
): WarfrontSetup {
    return {
        stance: WF_SETUP_STANCES.has(stance) ? stance : DEFAULT_SHARED_WARFRONT_SETUP.stance,
        doctrine: WF_SETUP_DOCTRINES.has(doctrine) ? doctrine : DEFAULT_SHARED_WARFRONT_SETUP.doctrine,
        buyPolicy: WF_SHARED_BUY_POLICIES.has(buyPolicy as SharedWfBuyPolicy)
            ? buyPolicy as SharedWfBuyPolicy
            : "balanced",
        deployment: sealedDeployment(authored.deployment),
        buildPackage: WF_BUILD_PACKAGES.has(authored.buildPackage as WfBuildPackage) ? authored.buildPackage as WfBuildPackage : DEFAULT_SHARED_WARFRONT_SETUP.buildPackage,
        coachOrder: WF_COACH_ORDERS.has(authored.coachOrder as WfCoachOrder) ? authored.coachOrder as WfCoachOrder : DEFAULT_SHARED_WARFRONT_SETUP.coachOrder,
        objectiveTechnique: WF_OBJECTIVE_TECHNIQUES.has(authored.objectiveTechnique as WfObjectiveTechnique) ? authored.objectiveTechnique as WfObjectiveTechnique : DEFAULT_SHARED_WARFRONT_SETUP.objectiveTechnique,
        counterstrike: WF_COUNTERSTRIKES.has(authored.counterstrike as WfCounterstrike) ? authored.counterstrike as WfCounterstrike : DEFAULT_SHARED_WARFRONT_SETUP.counterstrike,
    };
}

/** Accepted PvP reveals cross an authenticated server boundary. Unlike local
 * preference construction, every sealed field must be present and valid; a
 * malformed reveal must never silently become a different default strategy. */
export function parseWarfrontSetup(value: unknown): WarfrontSetup | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const setup = value as Partial<WarfrontSetup>;
    const fields = Object.keys(setup);
    const deployment = strictDeployment(setup.deployment);
    if (fields.length !== WF_SETUP_FIELDS.size || fields.some((field) => !WF_SETUP_FIELDS.has(field))
        || !WF_SETUP_STANCES.has(setup.stance as WfStance) || !WF_SETUP_DOCTRINES.has(setup.doctrine as WfDoctrine)
        || !WF_SHARED_BUY_POLICIES.has(setup.buyPolicy as SharedWfBuyPolicy) || !deployment
        || !WF_BUILD_PACKAGES.has(setup.buildPackage as WfBuildPackage) || !WF_COACH_ORDERS.has(setup.coachOrder as WfCoachOrder)
        || !WF_OBJECTIVE_TECHNIQUES.has(setup.objectiveTechnique as WfObjectiveTechnique) || !WF_COUNTERSTRIKES.has(setup.counterstrike as WfCounterstrike)) return null;
    return {
        stance: setup.stance as WfStance,
        doctrine: setup.doctrine as WfDoctrine,
        buyPolicy: setup.buyPolicy as SharedWfBuyPolicy,
        deployment,
        buildPackage: setup.buildPackage as WfBuildPackage,
        coachOrder: setup.coachOrder as WfCoachOrder,
        objectiveTechnique: setup.objectiveTechnique as WfObjectiveTechnique,
        counterstrike: setup.counterstrike as WfCounterstrike,
    };
}

/** Co-op setup crosses a long-lived lobby boundary, so unlike legacy PvP
 * notices it must be complete, versioned, and rejected rather than defaulted. */
export function parseVersionedWarfrontSetup(value: unknown): VersionedWarfrontSetup | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const setup = value as Partial<VersionedWarfrontSetup> & Record<string, unknown>;
    const fields = Object.keys(setup);
    const { version, ...unversioned } = setup;
    const parsed = version === 1 && fields.length === WF_SETUP_FIELDS.size + 1
        && fields.every((field) => field === "version" || WF_SETUP_FIELDS.has(field))
        ? parseWarfrontSetup(unversioned)
        : null;
    return parsed ? { version: 1, ...parsed } : null;
}

export type ArenaChallengeLike = {
    arenaSize?: 2 | 4;
    challengerTeamIds?: string[];
    challenger?: { pets?: Pet[] };
    responderTeam?: Pet[];
    petBattleSeed?: number;
    challengerWarfrontSetup?: WarfrontSetup;
    responderWarfrontSetup?: WarfrontSetup;
};
export type ArenaMatchPayload = {
    blue: Pet[];
    red: Pet[];
    size: 2 | 4;
    seed: number;
    blueSetup: WarfrontSetup;
    redSetup: WarfrontSetup;
    localTeam: ArenaTeam;
};

export type PlayerOwnedArenaMatch = {
    version: 1;
    challengeId: string;
    normalizedPlayerName: string;
    match: ArenaMatchPayload;
};

export const arenaSizeOf = (c: { arenaSize?: 2 | 4 }): 2 | 4 => (c.arenaSize === 2 ? 2 : 4);

// Drop inline data: sprites before a team rides the Realtime challenge
// inbox — art rehydrates from the shared-image cache by pet id on the peer.
export function stripInlinePetImages(pets: Pet[]): Pet[] {
    const inline = (v: unknown) => typeof v === "string" && v.startsWith("data:");
    return pets.map((p) => {
        const rec = p as Record<string, unknown>;
        if (!inline(rec.image) && !inline(rec.bodyImage)) return p;
        const out = { ...rec };
        if (inline(out.image)) delete out.image;
        if (inline(out.bodyImage)) delete out.bodyImage;
        return out as unknown as Pet;
    });
}

// The challenger's roster, resolved by id (in pick order) against the challenger
// snapshot — the same source on both clients, so the match stays in sync.
export const resolveChallengerTeam = (c: ArenaChallengeLike): Pet[] => {
    if (!Array.isArray(c.challengerTeamIds) || !Array.isArray(c.challenger?.pets)) return [];
    const pets = c.challenger.pets;
    return c.challengerTeamIds
        .map((id) => pets.filter((pet) => pet?.id === id))
        .map((matches) => matches.length === 1 ? matches[0] : null)
        .filter((pet): pet is Pet => Boolean(pet));
};

const isExactUniqueTeam = (pets: unknown, size: 2 | 4): pets is Pet[] => {
    if (!Array.isArray(pets) || pets.length !== size) return false;
    const ids = pets.map((pet) => pet && typeof pet === "object" ? (pet as Partial<Pet>).id : null);
    return ids.every((id): id is string => typeof id === "string" && id.trim().length > 0)
        && new Set(ids).size === size;
};

function strictAcceptedInputs(c: ArenaChallengeLike, redValue: unknown): Omit<ArenaMatchPayload, "localTeam"> | null {
    const size = c.arenaSize;
    if (size !== 2 && size !== 4) return null;
    if (!Number.isSafeInteger(c.petBattleSeed) || (c.petBattleSeed ?? 0) <= 0) return null;
    if (!Array.isArray(c.challengerTeamIds) || c.challengerTeamIds.length !== size
        || c.challengerTeamIds.some((id) => typeof id !== "string" || !id.trim())
        || new Set(c.challengerTeamIds).size !== size) return null;
    const blue = resolveChallengerTeam(c);
    if (!isExactUniqueTeam(blue, size) || !isExactUniqueTeam(c.responderTeam, size)
        || !isExactUniqueTeam(redValue, size)
        || c.responderTeam.some((pet, index) => pet.id !== redValue[index]?.id)) return null;
    const blueSetup = parseWarfrontSetup(c.challengerWarfrontSetup);
    const redSetup = parseWarfrontSetup(c.responderWarfrontSetup);
    if (!blueSetup || !redSetup) return null;
    return {
        blue,
        red: redValue,
        size,
        seed: c.petBattleSeed as number,
        blueSetup,
        redSetup,
    };
}

// Challenger side: resolve my roster + the responder's echoed roster from the
// accepted notice. Null when either roster is missing.
export function buildAcceptedArenaMatch(c: ArenaChallengeLike): ArenaMatchPayload | null {
    const match = strictAcceptedInputs(c, c.responderTeam);
    return match ? { ...match, localTeam: "blue" } : null;
}

/** Responder-side mirror of buildAcceptedArenaMatch. Keeping this pure makes it
 * difficult for the two clients to accidentally swap a team or read live local
 * preferences after the accepted payload has already been sealed. */
export function buildResponderArenaMatch(c: ArenaChallengeLike, red: Pet[]): ArenaMatchPayload | null {
    const match = strictAcceptedInputs(c, red);
    return match ? { ...match, localTeam: "red" } : null;
}

const normalizedIdentity = (value: string): string => value.trim().toLowerCase();

/** Carries a just-accepted match across App routing without letting an account
 * switch consume the previous player's full private reveal. */
export function ownArenaMatch(match: ArenaMatchPayload, playerName: string, challengeId: string): PlayerOwnedArenaMatch | null {
    const normalizedPlayerName = normalizedIdentity(playerName);
    if (!normalizedPlayerName || typeof challengeId !== "string" || !challengeId.trim() || challengeId.length > 128) return null;
    return { version: 1, challengeId, normalizedPlayerName, match };
}

export function arenaMatchOwnedByPlayer(value: PlayerOwnedArenaMatch, playerName: string): boolean {
    return value.version === 1 && Boolean(value.challengeId)
        && value.normalizedPlayerName === normalizedIdentity(playerName);
}
