/*
 * Per-village clan-hall lore — names, mottos, and flavor text shown in the
 * Clan Hall. Pure data, extracted verbatim from App.tsx.
 */

export const clanLore: Record<string, { name: string; motto: string; lore: string }> = {
    "Frostfang Village": {
        name: "Frostfang Clan Halls",
        motto: "Call the name. Wait for the answer.",
        lore: "Frostfang clans began as rescue companies that shared lantern oil, rope, and names during whiteout patrols. Each hall keeps its own roll, and every member is expected to answer it. The good halls remember that an answer only means something when a person is free to give it."
    },
    "Stormveil Village": {
        name: "Stormveil Challenge Houses",
        motto: "Post the reason. Answer in daylight.",
        lore: "Stormveil clans grow around arena crews, rigging teams, and rival houses that settle grievances in public. Leadership changes when someone posts a better challenge and survives the answer. A respected house remembers why a bout began after the crowd has forgotten."
    },
    "Ashen Leaf Village": {
        name: "Ashen Leaf Houses",
        motto: "Keep the root. Leave room to grow.",
        lore: "Ashen Leaf houses keep graft books, family crafts, and the names of those who fed their green years to the founders' fire. Their oldest duty is to carry a tradition without cutting every branch that grows differently. Some houses remember that duty better than others."
    },
    "Moonshadow Village": {
        name: "Moonshadow Trust Houses",
        motto: "Name the holder. Keep the terms.",
        lore: "Moonshadow clans are circles of aliases, witnesses, and sealed favors. Each house survives by knowing which truths it may hold and which must be returned. The dangerous houses confuse protection with ownership; the better ones write an exit into every agreement."
    }
};
