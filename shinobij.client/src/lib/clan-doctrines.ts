/*
 * Clan Doctrine — the clan's chosen identity, picked at creation. One doctrine
 * per clan gives a small, capped, NON-combat-power perk in its domain, so a clan
 * develops a character (war / economy / progression / support) instead of every
 * clan grinding the same 7 buildings to the same place.
 *
 * Magnitudes are intentionally conservative + centralised here so balance is
 * reviewable in one spot. Effects are ADDITIVE on top of the existing village +
 * clan-upgrade bonuses. The Warmonger war-HP value is mirrored server-side in
 * api/clan/war/_storage.ts (clan-war HP seeding) — KEEP THE TWO IN SYNC.
 */

export type ClanDoctrine = "none" | "warmonger" | "merchant" | "scholars" | "medics";

export const CLAN_DOCTRINES: Array<{ id: Exclude<ClanDoctrine, "none">; name: string; icon: string; blurb: string; effect: string }> = [
    { id: "warmonger", name: "Warmonger", icon: "⚔️", blurb: "Forged for war.", effect: `+${100} clan-war HP when your clan declares war` },
    { id: "merchant", name: "Merchant", icon: "💰", blurb: "Coin over conflict.", effect: `+5% village shop discount for members` },
    { id: "scholars", name: "Scholars", icon: "📖", blurb: "Knowledge is power.", effect: `+5% XP from training & missions for members` },
    { id: "medics", name: "Medics", icon: "⛑️", blurb: "None left behind.", effect: `-5% hospital cost for members` },
];

// Conservative capped magnitudes (tunable). KEEP WAR HP IN SYNC with the server.
export const DOCTRINE_SHOP_DISCOUNT = 5;
export const DOCTRINE_HOSPITAL_DISCOUNT = 5;
export const DOCTRINE_XP_BONUS = 5;
export const DOCTRINE_WAR_HP = 100;

const VALID = new Set<ClanDoctrine>(["warmonger", "merchant", "scholars", "medics"]);
export function normalizeDoctrine(d: unknown): ClanDoctrine {
    return typeof d === "string" && VALID.has(d as ClanDoctrine) ? (d as ClanDoctrine) : "none";
}
export function doctrineName(d: ClanDoctrine): string {
    return CLAN_DOCTRINES.find(x => x.id === d)?.name ?? "No Doctrine";
}
export function doctrineIcon(d: ClanDoctrine): string {
    return CLAN_DOCTRINES.find(x => x.id === d)?.icon ?? "🏳️";
}

// Per-domain bonus accessors — each returns 0 unless the clan's doctrine matches.
export function doctrineShopDiscount(d: ClanDoctrine): number { return d === "merchant" ? DOCTRINE_SHOP_DISCOUNT : 0; }
export function doctrineHospitalDiscount(d: ClanDoctrine): number { return d === "medics" ? DOCTRINE_HOSPITAL_DISCOUNT : 0; }
export function doctrineXpBonus(d: ClanDoctrine): number { return d === "scholars" ? DOCTRINE_XP_BONUS : 0; }
export function doctrineWarHp(d: ClanDoctrine): number { return d === "warmonger" ? DOCTRINE_WAR_HP : 0; }
