import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHostLoadout } from "./host-loadout";
import type { Character } from "../types/character";
import type { GameItem } from "../types/combat";

// An item forged this session still holds its upload inline. Two of them put a
// Tower / Clan Boss / World Boss / World Crisis start past the server's 256 KB
// default body limit.
const forged = (id: string, slot: string) => ({
    id, name: `Forged ${id}`, slot, type: "weapon", weaponEp: 30, bonuses: { damagePercent: 5 },
    image: `data:image/gif;base64,${"A".repeat(300 * 1024)}`,
    variants: [{ image: "data:image/png;base64,AAAA" }],
}) as unknown as GameItem;

test("a fight-start loadout keeps every equipped item and its stats, without inline art", () => {
    const creatorItems = [forged("blade", "weapon"), forged("plate", "armor")];
    const character = { name: "Rin", equipment: { weapon: "blade", armor: "plate" } } as unknown as Character;
    const withArt = buildHostLoadout(character, [], creatorItems);
    const ids = withArt.pvpItems.map((item) => item.id);
    assert.deepEqual([...ids].sort(), ["blade", "plate"]);
    for (const item of withArt.pvpItems) {
        const art = JSON.stringify(item);
        assert.ok(!art.includes("data:image"), `${item.id} still carries inline art`);
    }
    assert.ok(JSON.stringify(withArt).length < 8 * 1024, `${JSON.stringify(withArt).length} B`);
    // Same items and same numbers as the art-free build, so combat inputs are unchanged.
    const bare = buildHostLoadout(character, [], creatorItems.map((item) => ({ ...item, image: "", variants: [{ image: "" }] }) as GameItem));
    assert.deepEqual(withArt, bare);
    assert.deepEqual(ids, bare.pvpItems.map((item) => item.id));
    // The player's own items are untouched.
    assert.ok((creatorItems[0] as unknown as { image: string }).image.startsWith("data:image"));
});
