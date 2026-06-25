/*
 * Shared profession presentation data — name, tagline, icon, accent colour,
 * a one-line summary, perk bullets, and a couple of rank highlights.
 *
 * Single source of truth for the profession OVERVIEW screen (shown before a
 * profession is chosen) and the right-menu / mobile-menu dynamic button label.
 * Pure data, no runtime deps beyond the Profession union, so any screen or
 * component can import it without pulling in App.tsx.
 *
 * The numbers here are flavour/marketing copy that mirror docs/professions.md
 * and the constants in constants/profession.ts — they are NOT the source of
 * truth for the actual reward math (that lives in App.tsx / professionLogic.ts).
 */
import type { Profession } from "../types/core";

export type ProfessionInfo = {
    id: Profession;
    name: string;
    tagline: string;
    icon: string;
    accent: string;
    summary: string;
    perks: string[];
    rankHighlights: { rank: string; perk: string }[];
};

// Shared label/accent/icon lookups (kept here so the menu button and the
// overview agree with ProfessionRankBar / DailyProfessionMissions).
export const PROFESSION_LABEL: Record<Profession, string> = {
    healer: "Healer",
    vanguard: "Vanguard",
    petTamer: "Pet Tamer",
};

export const PROFESSION_ACCENT: Record<Profession, string> = {
    healer: "#22d3ee",
    vanguard: "#f97316",
    petTamer: "#84cc16",
};

export const PROFESSION_ICON: Record<Profession, string> = {
    healer: "✚",
    vanguard: "⚔",
    petTamer: "🐾",
};

// Ordered Healer → Vanguard → Pet Tamer for the overview layout.
export const PROFESSION_INFO: ProfessionInfo[] = [
    {
        id: "healer",
        name: "Healer",
        tagline: "Mend what war breaks.",
        icon: "✚",
        accent: "#22d3ee",
        summary:
            "A support shinobi who keeps the village standing. Heal wounded and knocked-out allies for profession XP equal to the share of HP you restore.",
        perks: [
            "Heal hospitalized allies in your village for XP",
            "Per-target cooldown shrinks and your own hospital timer shortens as you rank up",
            "+50% XP for Raid-Assist heals (allies fresh from a fight)",
            "Rank 10: see & heal injured villagers anywhere in the world",
        ],
        rankHighlights: [
            { rank: "Rank 1", perk: "Heal admitted allies · 5-min per-target cooldown" },
            { rank: "Rank 10", perk: "World-wide healing · 1.5-min cooldown · 15s self-discharge" },
        ],
    },
    {
        id: "vanguard",
        name: "Vanguard",
        tagline: "Lead the charge.",
        icon: "⚔",
        accent: "#f97316",
        summary:
            "A frontline shinobi who thrives on conflict. Earn Honor Seals by defeating real players and raiding enemy villages.",
        perks: [
            "Earn 1–5 Honor Seals per PvP kill (scales with rank)",
            "Raid enemy villages for bonus Ryo",
            "Discounted jutsu training with Honor Seals at Rank 8",
            "Rank 10: +1 Honor Seal per raid completed",
        ],
        rankHighlights: [
            { rank: "Rank 1", perk: "1 Seal per kill · daily seal cap 50" },
            { rank: "Rank 10", perk: "5 Seals per kill · bonus raid Seals · training discount" },
        ],
    },
    {
        id: "petTamer",
        name: "Pet Tamer",
        tagline: "Walk with beasts.",
        icon: "🐾",
        accent: "#84cc16",
        summary:
            "A shinobi who fights alongside tamed beasts. Your companions hit harder in PvE, train faster, and bring home richer expedition hauls.",
        perks: [
            "Pets deal +6.5% to +20% more PvE damage by rank",
            "Pet training 10–20% faster",
            "Expedition rewards +10% to +25%",
            "First expedition each day grants 2× Tamer XP",
        ],
        rankHighlights: [
            { rank: "Rank 1", perk: "+6.5% pet PvE damage · +10% training speed" },
            { rank: "Rank 10", perk: "+20% pet PvE damage · +25% expedition rewards" },
        ],
    },
];
