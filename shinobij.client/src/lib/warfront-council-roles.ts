import type { ArenaRole } from "./pet-arena-sim";
import type { WfBuildPackage, WfObjectiveTechnique } from "./pet-warfront-sim";

export const WARFRONT_PACKAGE_ROLE: Readonly<Record<WfBuildPackage, ArenaRole>> = {
    "hold-line": "defender",
    "blood-hunt": "assassin",
    "escort-rite": "sage",
};

export const WARFRONT_TECHNIQUE_ROLE: Readonly<Record<WfObjectiveTechnique, ArenaRole>> = {
    secure: "tracker",
    hijack: "assassin",
    zone: "defender",
};

export const WARFRONT_ROLE_LABEL: Readonly<Record<ArenaRole, string>> = {
    defender: "Defender",
    assassin: "Assassin",
    sage: "Sage",
    tracker: "Tracker",
};

export function hasWarfrontRole(roles: ReadonlySet<ArenaRole>, role: ArenaRole): boolean {
    return roles.has(role);
}

export function firstViableWarfrontChoice<T extends string>(
    preferred: T,
    choices: readonly T[],
    requiredRole: Readonly<Record<T, ArenaRole>>,
    roles: ReadonlySet<ArenaRole>,
): T | undefined {
    if (roles.has(requiredRole[preferred])) return preferred;
    return choices.find((choice) => roles.has(requiredRole[choice]));
}
