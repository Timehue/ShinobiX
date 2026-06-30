/*
 * Roaming-merc client glue (Phase 5 — roaming rebuild). Fetches the server roster
 * of mercs hostile to the player in a sector and synthesizes wanderer-shaped NPCs
 * so they render with the existing <SectorWanderer> (they "look like the wandering
 * NPCs"). The fight itself is resolved SERVER-SIDE via the engage call — the client
 * only triggers + displays it.
 *
 * Pure where it matters (synthMercWanderer + helpers are deterministic from the
 * merc id, so a merc doesn't teleport between roster polls); the two fetch wrappers
 * are the only IO. Kept out of merc-ai.ts so it stays node-testable (merc-ai.ts
 * imports .webp portraits, which break outside Vite).
 */
import type { Wanderer } from "./wanderers";

export interface RoamingMercView {
    id: string;            // merc-<villageSlug>-<tierId>-<index>
    village: string;       // the attacking village (hostile to the viewer)
    tierId: string;
    level: number;
    context: "sector" | "village";
}

export interface MercEngageResult {
    ok?: boolean;
    context?: "sector" | "village";
    winner?: "merc" | "player" | "stall";
    captured?: boolean;
    controlHp?: number;
    enemyWarHp?: number | null;
    mercsRemaining?: number;
    error?: string;
}

// ── fetch wrappers (auth rides the globally-patched window.fetch, like the rest
//    of the war-map). roster is read-only; engage is server-authoritative. ──
export async function fetchMercRoster(playerName: string, village: string, sector: number): Promise<RoamingMercView[]> {
    const r = await fetch("/api/sector/merc-roam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "roster", playerName, village, sector }),
    });
    if (!r.ok) return [];
    const data = (await r.json().catch(() => ({}))) as { mercs?: RoamingMercView[] };
    return Array.isArray(data.mercs) ? data.mercs : [];
}

/** Resolve an encounter with a roaming merc SERVER-SIDE. Never throws on a normal
 *  rejection (cooldown / no-longer-there) — those come back as { error } so the UI
 *  can show them plainly. */
export async function engageMerc(playerName: string, village: string, sector: number, mercId: string): Promise<MercEngageResult> {
    const r = await fetch("/api/sector/merc-roam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "engage", playerName, village, sector, mercId }),
    });
    return (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as MercEngageResult;
}

// ── deterministic NPC synthesis ───────────────────────────────────────────────
const MERC_TIER_NAMES: Record<string, string> = {
    ronin: "Rōnin Blade",
    reaver: "Border Reaver",
    shadow: "Shadow Blade",
    oni: "Oni Mercenary",
    warlord: "Mercenary Warlord",
};
export function mercTierName(tierId: string): string {
    return MERC_TIER_NAMES[tierId] ?? "Mercenary";
}

const MERC_TAUNTS = [
    "You're a long way from home, leaf. The contract says you don't get back.",
    "Hired blade. Nothing personal — just paid to end you.",
    "Wrong territory to wander into.",
    "The coin says you fall here.",
];

function hashStr(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

// An interior tile of the 12×12 sector board (cols/rows 2..9), away from the chrome.
function mercTile(seed: number): number {
    const col = 2 + (seed % 8);
    const row = 2 + (Math.floor(seed / 8) % 8);
    return row * 12 + col;
}

/** A wanderer-shaped, hostile, attacking NPC for a roaming merc — rendered by the
 *  existing <SectorWanderer> (bandit visuals, crimson tell). Placement is
 *  deterministic from the merc id so it doesn't jump around between roster polls.
 *  The id (merc-…) is what the engage call + isMercAiId() key off. */
export function synthMercWanderer(merc: RoamingMercView): Wanderer {
    const h = hashStr(merc.id);
    const home = mercTile(h);
    const waypoints = Array.from(new Set([home, mercTile(h >>> 3), mercTile(h >>> 6)]));
    return {
        id: merc.id,
        name: mercTierName(merc.tierId),
        archetype: "bandit",
        verb: "attack",
        level: merc.level,
        homeTile: home,
        waypoints,
        greeting: MERC_TAUNTS[h % MERC_TAUNTS.length],
        tellTint: "#b91c1c", // merc crimson — distinct from the bandit orange-red
        avatarKey: "bandit",
    };
}
