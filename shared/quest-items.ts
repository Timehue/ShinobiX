/*
 * Quest-only items: the materials a quest line has the player gather, the
 * tools it has them make, and the things its fights drop.
 *
 * A quest-only item exists for its quest and nowhere else. It cannot be bought
 * or sold, traded, donated or listed, and it can never be worn into an ordinary
 * fight or into PvP: a quest's own fight is handed the tool by the server for
 * that fight alone. Every one of those doors checks isQuestOnlyItem.
 *
 * Kept out of the client's startup item table on purpose (that file is in the
 * first download, which has no room left). The server reads this module
 * directly; the client loads it only on screens that show a quest item.
 *
 * Tools use the game's existing item fields and nothing new. Their AP cost,
 * range, cooldown and power are the engine's defaults for a thrown item (the
 * owner let the tool numbers stand on 2026-11-19).
 */

export interface QuestItemDef {
    id: string;
    name: string;
    /** 'item' for a material or a tool that is used; 'thrown' for a tool that is thrown. */
    slot: 'item' | 'thrown';
    rarity: 'common' | 'rare' | 'epic';
    /** Always 0: a quest item has no price and no buy-back. */
    cost: 0;
    image: string;
    description: string;
    bonuses: Record<string, never>;
    questOnly: true;
    /** What kind of thing it is, for the quest screens. */
    kind: 'material' | 'tool' | 'proof';
    weaponEp?: number;
    weaponRange?: number;
    weaponCooldown?: number;
    apCost?: number;
}

/**
 * Materials with no painted icon yet, and the shipped icon each one borrows
 * until its own arrives. The icon a material should have is always
 * `/items/<id>-v1.webp`; when that file ships, the entry here must go
 * (api/quests/_quest-items.test.ts fails until it does).
 */
export const QUEST_ITEM_ICON_STAND_INS: Readonly<Record<string, string>> = {
};

const material = (id: string, name: string, description: string): QuestItemDef => ({
    id, name, slot: 'item', rarity: 'common', cost: 0, image: QUEST_ITEM_ICON_STAND_INS[id] ?? `/items/${id}-v1.webp`, description, bonuses: {}, questOnly: true, kind: 'material',
});
const proof = (id: string, name: string, description: string): QuestItemDef => ({
    id, name, slot: 'item', rarity: 'rare', cost: 0, image: `/items/${id}-v1.webp`, description, bonuses: {}, questOnly: true, kind: 'proof',
});
/** A tool that is thrown. Power, range, cost and cooldown are the engine's thrown-item defaults. */
const thrownTool = (id: string, name: string, description: string): QuestItemDef => ({
    id, name, slot: 'thrown', rarity: 'rare', cost: 0, image: `/items/${id}-v1.webp`, description, bonuses: {}, questOnly: true, kind: 'tool',
    weaponEp: 15, weaponRange: 4, weaponCooldown: 5, apCost: 40,
});
/**
 * A tool that is used, not thrown: shown, read out, poured. It breaks its Hold
 * and does nothing else: no damage and no healing (api/solo-pve/_engine.ts).
 */
const usedTool = (id: string, name: string, description: string): QuestItemDef => ({
    id, name, slot: 'item', rarity: 'rare', cost: 0, image: `/items/${id}-v1.webp`, description, bonuses: {}, questOnly: true, kind: 'tool',
    apCost: 35,
});

export const QUEST_ITEMS: readonly QuestItemDef[] = [
    // The Shuttered Boat (home map).
    proof('quest-runner-tally', "Runner's Tally", 'A knotted cord the chart runner left with his lookouts. Each knot is a place he means to stop.'),
    thrownTool('quest-signal-shard', 'Stormglass Signal Shard', 'Struck stormglass bound in cord. It breaks into a hard white light that smoke cannot hold. Made for the night crossing.'),

    // Saltstair Landing.
    material('quest-wrack-cord', 'Wrack Cord', 'Salt-cured fibre cut from the drift line at Wrack Strand. It takes ink and it takes a seal.'),
    material('quest-splitstone-fittings', 'Splitstone Fittings', 'Bright fittings worked loose from the seam at Splitstone. The boatwright will not rig a hull without them.'),
    material('quest-woundroot', 'Woundroot', 'A bitter root from the bank above the landing. The Unmoored steep it to close their wounds.'),
    proof('quest-garrison-seal', 'Garrison Seal', 'A cinnabar seal lifted from an Unmoored patrol. The garrison obeys paper that carries it.'),
    usedTool('quest-stand-down-order', 'Forged Stand-Down Order', 'An order in the garrison hand, under the garrison seal. Guards who are shown it stand aside.'),
    thrownTool('quest-woundroot-vial', 'Woundroot Vial', 'Woundroot reduced until it turns. It spoils the draught it was made to imitate.'),

    // Brackwater Fields.
    material('quest-inkseed', 'Inkseed', 'Black seed heads cut from the bed at Sedgeglass Run. Crushed, they stain water for a day.'),
    material('quest-mirror-silt', 'Mirror Silt', 'Pale silt worked from the rim of the Mirror Pool. It hangs in water and will not settle.'),
    thrownTool('quest-clouding-ink', 'Clouding Ink', 'Inkseed ground into mirror silt and sealed in a reed tube. It clouds whatever it strikes. A mirror cannot return what it cannot see.'),

    material('quest-pitchwood', 'Pitchwood', 'Resin-heavy drift timber from Pitchwrack Strand. Boiled down, it caulks a hull.'),
    material('quest-caulk-eel', 'Caulk Eel', 'A slick eel from the Sounding Pool. Its skin renders into a glue that sets under water.'),

    // Briarwood Deep.
    material('quest-keelroot', 'Keelroot', 'A buttress root from Keelroot Fall, grown in the curve a keel needs.'),
    material('quest-binding-thorn', 'Binding Thorn', 'Long thorn canes from Briar Spindle. Tamers strip them into cord that holds a knot under any strain.'),
    material('quest-tether-link', 'Tether Link', 'An iron link worked loose from the sundered tether at the Broken Collar. It has held a bonded beast before.'),
    thrownTool('quest-pact-cutter-snare', 'Pact-Cutter Snare', 'Thorn cord tied in a tamer’s own knot and weighted with tether links. Only a tamer’s knot cuts a tamer’s bond.'),

    // Whitecrown Passes.
    material('quest-emberglass', 'Emberglass', 'Dark glass from the seam at Whitevein Cut. Struck, it holds its heat for an hour.'),
    material('quest-frost-splinter', 'Frost Splinter', 'A needle of stone split from the Frost Witness. It takes a point and keeps it.'),
    thrownTool('quest-ember-senbon', 'Ember Senbon', 'A stone needle tipped with struck emberglass. Heat at the seams splits frost plates apart.'),

    // Hushcrown Heights: what the Remakers' workshop makes the earlier tools from.
    material('quest-windroot', 'Windroot', 'A pale root from the Red Underbough. It does the work of woundroot, and of cord when it is dried.'),
    material('quest-silver-grit', 'Silver Grit', 'Bright grit from the Silver Seam. The Remakers cast it into fittings, links and needle points.'),
    material('quest-ink-loach', 'Ink Loach', 'A black loach from the Pool of the Second Sky. Pressed, it gives an ink that clouds still water.'),

    // Untamed Coast: what a coast beast will come to, in each region it is hunted.
    material('quest-needle-fish', 'Needle Fish', 'A thin silver fish from Needle Shoal. The hounds of the landing follow its oil.'),
    material('quest-scent-carp', 'Scent Carp', 'A dark carp from the Scentwater Shelf. Left a day, it can be smelled across the basin.'),
    material('quest-icebell-smelt', 'Icebell Smelt', 'A pale smelt from under the Icebell Shelf. It keeps its scent in the cold.'),
    material('quest-scent-lure', 'Scent Lure', 'Fish oil worked into a twist of cord. Set downwind, it brings a beast to where you wait with your companion.'),
];

const BY_ID: ReadonlyMap<string, QuestItemDef> = new Map(QUEST_ITEMS.map(item => [item.id, item]));

export function questItem(id: unknown): QuestItemDef | undefined {
    return typeof id === 'string' ? BY_ID.get(id) : undefined;
}

/** True for an item that belongs to a quest and must stay inside it. */
export function isQuestOnlyItem(id: unknown): boolean {
    return typeof id === 'string' && BY_ID.has(id);
}
