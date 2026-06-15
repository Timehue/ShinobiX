/*
 * Painted role-badge icons — transparent emblem cutouts (gpt-image-1) keyed by
 * native pet ROLE. These replace the emoji glyphs in ROLE_META for the on-card /
 * picker role badges (kept as a separate map so ROLE_META stays a pure data table
 * with no asset-bundler imports, and non-UI callers don't pull in webp URLs).
 */
import type { PetRole } from "./pet-roles";
import roleDefender from "../assets/roles/role-defender.webp";
import roleTracker from "../assets/roles/role-tracker.webp";
import roleAssassin from "../assets/roles/role-assassin.webp";
import roleSage from "../assets/roles/role-sage.webp";

export const ROLE_ICON: Record<PetRole, string> = {
    defender: roleDefender,
    tracker: roleTracker,
    assassin: roleAssassin,
    sage: roleSage,
};
