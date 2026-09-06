/*
 * Per-village clan-hall lore — names, mottos, and flavor text shown in the
 * Clan Hall. Pure data, extracted verbatim from App.tsx.
 */

export const clanLore: Record<string, { name: string; motto: string; lore: string }> = {
    "Frostfang Village": {
        name: "Frostfang Clan Halls",
        motto: "Call the name. Wait for the answer.",
        lore: "Hall histories trace Frostfang's clans to rescue companies that shared lantern oil, rope, and names during whiteouts. Each hall keeps its own roll and expects every member to answer. A note copied into several old rolls adds: an answer counts only when the named person is free to give it."
    },
    "Stormveil Village": {
        name: "Stormveil Challenge Houses",
        motto: "Post the reason. Answer in daylight.",
        lore: "The rules posted in Stormveil's house courts describe clans built around arena crews, rigging teams, and public rivalries. They say leadership changes through an answered challenge. In the margin, each house records the reason for a bout before the crowd supplies a louder one."
    },
    "Ashen Leaf Village": {
        name: "Ashen Leaf Houses",
        motto: "Keep the root. Leave room to grow.",
        lore: "Ashen Leaf graft books preserve family crafts and the names of people recorded as giving their green years to the founders' fire. An older duty line reads: keep the root and leave room for a new branch. House records disagree often about how much room that means."
    },
    "Moonshadow Village": {
        name: "Moonshadow Trust Houses",
        motto: "Name the holder. Keep the terms.",
        lore: "Moonshadow house ledgers describe circles of aliases, witnesses, and sealed favors. Their model agreement names what the house may hold, when it must return it, and how either party may leave. Older ledgers omit that last clause often enough that the newer copyists mark it in red."
    }
};
