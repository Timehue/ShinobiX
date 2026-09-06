/**
 * Admin save hydration — drained verbatim out of App.tsx.
 *
 * normalizeAdminCharacter is the admin-account wrapper around
 * lib/normalize-character: every path that loads an admin snapshot (the admin
 * panel's player picker, the versioned-save acceptor, the account switcher)
 * runs the stored row through the normal player normalizer first, then forces
 * the two things an admin account must always have — maxed stats with nothing
 * unspent, and a finished tutorial. A non-admin name falls straight through
 * with only the ordinary normalization applied.
 *
 * It sits in lib/ rather than App.tsx because it needs nothing from App: every
 * dependency is already a lib module, so moving it here neither creates the
 * lib -> App import that makes consumers unloadable under node:test, nor costs
 * App.tsx a line of its budget.
 */
import { normalizeCharacter } from "./normalize-character";
import { isAdminAccountName } from "./admin-identity";
import { maxedStats } from "./stats";
import type { Character } from "../types/character";

export function normalizeAdminCharacter(character: Character): Character {
    const normalized = normalizeCharacter(character);
    if (!isAdminAccountName(normalized.name)) return normalized;
    return {
        ...normalized,
        stats: maxedStats(),
        unspentStats: 0,
        // Admins are name-gated out of every tutorial surface — never a live step.
        onboardingStep: "done",
    };
}
