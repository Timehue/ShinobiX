import type { GameItem } from "../types/combat";

export const eventItems: GameItem[] = [
    {
        id: "event-kesa-storm-seal",
        name: "Kesa's Storm-Seal",
        image: "/items/event-kesa-storm-seal.webp",
        slot: "relic",
        rarity: "epic",
        cost: 0,
        levelReq: 58,
        description: "A recovered seal tied to Kesa Volt's reason, carried back from the Stormveil outskirts.",
        flavorText: "The account closed. The reason stayed.",
        // No maxChakra/maxStamina here: pools come from LEVEL alone
        // (maxChakraForLevel), so an item vitals bonus never reached any pool —
        // it only showed in the popup. Dropped 2026-08-16 by owner ruling.
        bonuses: { ninjutsuOffense: 10 , pveDamagePercent: 3 },
    },
    {
        id: "event-kesa-marker",
        name: "Kesa's Ridge Marker",
        slot: "waist",
        rarity: "rare",
        cost: 0,
        levelReq: 25,
        description: "A pressed ridge marker gathered for Mira Volt, proof that Kesa was a person before she was an account.",
        flavorText: "A line on a ridge. A name in a daughter's hand.",
        bonuses: { taijutsuDefense: 16, willpower: 10 },
    },
    // ── Ashen Leaf ────────────────────────────────────────────────────────────
    {
        id: "event-reed-tally",
        name: "Reed Family Tally",
        slot: "head",
        rarity: "rare",
        cost: 0,
        levelReq: 30,
        description: "A scorched cedar register-plate carved with the Reed name, gathered from the ash road for Toma Reed and kept from the fire.",
        flavorText: "A name is not a number until someone decides to spend it.",
        // No maxChakra/maxStamina here: pools come from LEVEL alone
        // (maxChakraForLevel), so an item vitals bonus never reached any pool —
        // it only showed in the popup. Dropped 2026-08-16 by owner ruling.
        bonuses: { intelligence: 8 , pveDamageTakenPercent: 2 },
    },
    {
        id: "event-struck-nameplate",
        name: "Aren's Struck Name-Plate",
        image: "/items/event-struck-nameplate.webp",
        slot: "relic",
        rarity: "epic",
        cost: 0,
        levelReq: 58,
        description: "The struck cedar register-plate the drain scrubbed and Redactor Sella carried toward the fire, recovered at the Ashen Leaf outskirts and returned to Elder Mori's working copy.",
        flavorText: "Aren Reed. Struck once. Read again, by you.",
        bonuses: { ninjutsuOffense: 11, willpower: 8 , pveDamagePercent: 3 },
    },
    // ── Frostfang ─────────────────────────────────────────────────────────────
    {
        id: "event-true-roll-page",
        name: "A Page of the True Roll",
        image: "/items/event-true-roll-page.webp",
        slot: "relic",
        rarity: "rare",
        cost: 0,
        levelReq: 42,
        description: "A page of the roll that lists the names the official Count struck, blown across the snow and gathered back for Elder Sova.",
        flavorText: "The Count keeps who is owed. This keeps who is missed.",
        // No maxChakra/maxStamina here: pools come from LEVEL alone
        // (maxChakraForLevel), so an item vitals bonus never reached any pool —
        // it only showed in the popup. Dropped 2026-08-16 by owner ruling.
        bonuses: { willpower: 9 , pveDamageTakenPercent: 2 },
    },
    {
        id: "event-struck-warmth-token",
        name: "A Struck Warmth-Token",
        slot: "waist",
        rarity: "epic",
        cost: 0,
        levelReq: 58,
        description: "A warmth-token confiscated from someone struck off the roll, taken back from Meter-Warden Kree at the Frostfang outskirts and carried to Captain Yura.",
        flavorText: "Warmth was never supposed to have a meter.",
        bonuses: { taijutsuDefense: 20, intelligence: 12 },
    },
    // ── Moonshadow ────────────────────────────────────────────────────────────
    {
        id: "event-unsworn-page",
        name: "Nyx's Unsworn Page",
        image: "/items/event-unsworn-page.webp",
        slot: "relic",
        rarity: "rare",
        cost: 0,
        levelReq: 30,
        description: "A torn page from Nyx's own ledger, the one that names buyers instead of victims, gathered from a raided booth and returned to her.",
        flavorText: "Most ledgers name who owes. Hers names who bought.",
        bonuses: { speed: 6, intelligence: 8 , pveDamageTakenPercent: 2 },
    },
    {
        id: "event-sealed-file",
        name: "A Sealed File",
        image: "/items/event-sealed-file.webp",
        slot: "relic",
        rarity: "epic",
        cost: 0,
        levelReq: 58,
        description: "A sealed name-file the Auction-Enforcer was selling off the shelf, taken back at the Moonshadow outskirts and closed for good by Shade Master Iro.",
        flavorText: "Filed under load-bearing. A person. Filed under load-bearing.",
        // No maxChakra/maxStamina here: pools come from LEVEL alone
        // (maxChakraForLevel), so an item vitals bonus never reached any pool —
        // it only showed in the popup. Dropped 2026-08-16 by owner ruling.
        bonuses: { genjutsuOffense: 11 , pveDamagePercent: 3 },
    },
    // ── Cross-village (Kite Harrow) ───────────────────────────────────────────
    {
        id: "event-forged-die",
        name: "The Forged Escrow-Die",
        image: "/items/event-forged-die.webp",
        slot: "relic",
        rarity: "epic",
        cost: 0,
        levelReq: 65,
        description: "A counterfeit stamp cut to forge the quartered-circle escrow mark and skim the drain across all four villages, recovered on a contract Kite Harrow keeps off every roll.",
        flavorText: "Even the thieves have thieves. Harrow keeps the receipt.",
        bonuses: { intelligence: 9, ninjutsuOffense: 9 , pveDamagePercent: 3 },
    },
];

export const eventItemIds = new Set(eventItems.map((item) => item.id));
