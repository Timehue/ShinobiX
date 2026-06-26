"use strict";
/*
 * War Mercenaries — pure, testable core for the Town Hall "hire mercenaries"
 * feature (api/village/hire-mercenary.ts). Unit-testable without KV / auth /
 * locks (same pattern as api/sector/_wanderer-quest.ts).
 *
 * A village-war participant can hire mercenary bands to fight on their side. Each
 * tier costs Honor Seals (a Vanguard-PvP currency, deliberately hard to amass) and
 * lands a fixed chunk of war damage on the enemy village, attributed to the hiring
 * player's contributions. Mercenaries are a *honor-seal SINK* and a force-multiplier,
 * NOT a win button: their damage is floored so a merc can never deliver the killing
 * blow (a real player must finish the war), and each tier can be hired at most once
 * per war (the contract resets when a new war begins). The tier table + costs are
 * SEALED here server-side; the client catalog (shinobij.client/src/lib/mercenaries.ts)
 * mirrors it for display only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MERCENARY_TIERS = void 0;
exports.isMercenaryTierId = isMercenaryTierId;
exports.mercenaryById = mercenaryById;
exports.applyMercenaryDamage = applyMercenaryDamage;
// Five tiers, levels 75 / 80 / 85 / 95 / 100 (owner spec). Cost + damage both
// climb with tier; the high tiers are slightly more damage-per-seal so saving for
// a Warlord is worth it. Even all five together (2450 seals → 1890 dmg) can't end
// a 5000-HP war alone — they soften the enemy, players land the finish.
exports.MERCENARY_TIERS = [
    { id: "merc-ronin", level: 75, name: "Rōnin Blade", blurb: "A masterless sword for hire — cheap, reliable, gone by morning.", costSeals: 150, warDamage: 120 },
    { id: "merc-reaver", level: 80, name: "Border Reaver", blurb: "Raiders who know the enemy's supply lines better than their Kage.", costSeals: 250, warDamage: 200 },
    { id: "merc-shadow", level: 85, name: "Shadow-for-Hire", blurb: "Nukenin who strike from the dark and never sign a name.", costSeals: 400, warDamage: 320 },
    { id: "merc-oni", level: 95, name: "Oni Mercenary", blurb: "A demon-masked killer the enemy will feel before they see.", costSeals: 650, warDamage: 500 },
    { id: "merc-warlord", level: 100, name: "Mercenary Warlord", blurb: "An entire warband under one banner — the price of a small army.", costSeals: 1000, warDamage: 750 },
];
const BY_ID = Object.fromEntries(exports.MERCENARY_TIERS.map(t => [t.id, t]));
function isMercenaryTierId(id) {
    return Object.prototype.hasOwnProperty.call(BY_ID, id);
}
function mercenaryById(id) {
    return isMercenaryTierId(id) ? BY_ID[id] : null;
}
/**
 * Apply a mercenary's war damage to an enemy village's HP. Floored at 1 so a
 * mercenary can NEVER reduce a village to 0 (i.e. can't end the war) — a live
 * player must land the killing blow. Returns the new HP + the damage actually dealt.
 */
function applyMercenaryDamage(prevEnemyHp, warDamage) {
    const prev = Math.max(0, Math.floor(Number(prevEnemyHp) || 0));
    const dmg = Math.max(0, Math.floor(Number(warDamage) || 0));
    const nextHp = Math.max(1, prev - dmg);
    return { nextHp, dealt: Math.max(0, prev - nextHp) };
}
