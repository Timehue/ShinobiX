import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./UserHub.tsx", import.meta.url), "utf8");

test("User Hub exposes distinct Following, Friends, and Blocked lists", () => {
    assert.match(source, /★ Following/);
    assert.match(source, /♥ Friends/);
    assert.match(source, /⊘ Blocked/);
    assert.match(source, /Add a friend by player name/);
    assert.match(source, /Block a player by name/);
    assert.match(source, /Enter exact player name/);
});

test("Friends and Blocked rows expose reversible list actions", () => {
    assert.match(source, />Remove<\/button>/);
    assert.match(source, />Unblock<\/button>/);
    assert.match(source, /addFriend\(currentName, target\)/);
    assert.match(source, /\/api\/player\/blocks/);
});

test("a Cinderhold row offers no follow star, as its profile offers no follow", () => {
    // The star used to be pressable and then refused ("You can't challenge or follow NPCs.").
    assert.match(source, /isNpcVillage\(p\.village\) && !isFollowed \? null : \(/);
    assert.match(source, /import \{ isNpcVillage \} from "\.\.\/\.\.\/\.\.\/shared\/npc-village";/);
});

test("directory avatars load lazily so opening Users does not fetch every player's art", () => {
    // Measured live on 2026-11-04: 186 eager avatars (some 0.7-2 MB GIFs shown at
    // 46px) made the Users page a ~10 MB download with only ~52 rows on screen.
    const avatarImg = source.match(/<img src=\{avatar\}[^>]*\/>/);
    assert.ok(avatarImg, "UserHubRow avatar <img> not found");
    assert.match(avatarImg[0], /loading="lazy"/);
    assert.match(avatarImg[0], /decoding="async"/);
});
