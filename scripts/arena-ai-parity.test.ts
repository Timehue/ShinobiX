import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVER_ARENA_PETS } from "../api/pet/_arena-ai";
import { genericPetArenaOpponents } from "../shinobij.client/src/data/pet-arena-opponents";

/*
 * SERVER_ARENA_PETS is the authoritative AI roster: the Warfront AI team
 * (api/pet/_warfront-ai.ts) and the arena lobby AI pool (api/arena/_lobby-core.ts)
 * are built from it, battle-start resolves pre-cutover AI receipts against it,
 * and the client receives the sealed pets it fights. The client's genericPetArenaOpponents supplies only the
 * cosmetics (portrait, body art) layered onto those sealed pets, so its element
 * and headline stats must still match what the player is shown fighting.
 *
 * This file used to also assert WINNER parity by running both rosters through
 * the legacy duel sim, from when the client resolved AI fights locally from its
 * own copy. That flow was retired (the server seals every AI team) and the sim
 * with it on 2026-10-02. The jutsu lists of the two copies have drifted (the
 * client copies carry signature moves the server copies do not); no live fight
 * reads the client's jutsus, so that drift is recorded here rather than masked.
 */
test("SERVER_ARENA_PETS matches client genericPetArenaOpponents (element + stats)", () => {
    for (const o of genericPetArenaOpponents) {
        const c = o.pet;
        const s = SERVER_ARENA_PETS[c.id];
        assert.ok(s, `server is missing AI pet ${c.id}`);
        assert.equal(s.element, c.element, `${c.id} element drift`);
        assert.equal(s.hp, c.hp, `${c.id} hp drift`);
        assert.equal(s.attack, c.attack, `${c.id} attack drift`);
        assert.equal(s.defense, c.defense, `${c.id} defense drift`);
        assert.equal(s.speed, c.speed, `${c.id} speed drift`);
        assert.equal(s.level, c.level, `${c.id} level drift`);
        assert.equal(s.rarity, c.rarity, `${c.id} rarity drift`);
    }
});
