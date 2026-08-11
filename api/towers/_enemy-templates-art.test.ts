import assert from "node:assert/strict";
import test from "node:test";
import { GROUND_EFFECT_TAGS, canonicalTagName } from "../pvp/_tags";
import { ENEMY_TEMPLATE_IDS, getEnemyTemplate, requireEnemyTemplate } from "./_enemy-templates";

const PUBLISHED_TOWER_VISUALS = new Set([
    "bandit", "archer", "blocker", "brute", "acolyte", "warden", "ravager", "genin", "revenant", "sovereign",
    "clan-boss-oni", "clan-boss-leviathan", "clan-boss-kage", "clan-boss-golem",
]);

test("every authored enemy template points at a published Tower portrait key", () => {
    for (const id of ENEMY_TEMPLATE_IDS) {
        assert.ok(PUBLISHED_TOWER_VISUALS.has(getEnemyTemplate(id).visual), `${id} references missing visual ${getEnemyTemplate(id).visual}`);
    }
});

test("clan boss encounters expose their dedicated client portrait keys", () => {
    for (const id of ["clan-boss-oni", "clan-boss-leviathan", "clan-boss-kage", "clan-boss-golem"]) {
        assert.equal(getEnemyTemplate(id).visual, id);
    }
});

test("story grunts ship tactical roles and authored combat kits", () => {
    for (const id of ["grunt-bandit", "grunt-archer", "grunt-blocker", "grunt-brute", "grunt-acolyte"]) {
        const template = getEnemyTemplate(id);
        assert.ok(template.role, `${id} has a tactical role`);
        assert.ok((template.jutsu?.length ?? 0) >= 1, `${id} has at least one real technique`);
    }
    assert.ok((getEnemyTemplate("grunt-archer").jutsu ?? []).some(jutsu => (jutsu.range ?? 0) >= 4), "archers fight at range");
    assert.ok((getEnemyTemplate("grunt-acolyte").jutsu ?? []).some(jutsu => jutsu.target === "EMPTY_GROUND"), "acolytes control ground");
});

test("story and Spire bosses ship multi-technique phase-ready kits", () => {
    for (const id of [
        "boss-warden", "boss-ravager", "boss-revenant", "boss-sovereign",
        "spire-warden", "spire-ravager", "spire-revenant", "spire-sovereign",
    ]) {
        const template = getEnemyTemplate(id);
        assert.equal(template.role, "boss", `${id} is classified as a boss`);
        assert.ok((template.jutsu?.length ?? 0) >= 3, `${id} has damage, control, and phase utility`);
        assert.ok(template.jutsu?.some(jutsu => jutsu.target === "SELF" || jutsu.target === "EMPTY_GROUND"), `${id} has a non-basic tactical option`);
    }
});

test("every authored ground-control technique uses canonical persistent-zone tags", () => {
    for (const id of ENEMY_TEMPLATE_IDS) {
        for (const jutsu of getEnemyTemplate(id).jutsu ?? []) {
            if (jutsu.target !== "EMPTY_GROUND") continue;
            const supported = (jutsu.tags ?? []).some(raw => {
                const name = typeof raw === "object" && raw !== null && "name" in raw
                    ? String((raw as { name?: unknown }).name ?? "")
                    : "";
                return GROUND_EFFECT_TAGS.has(canonicalTagName(name));
            });
            assert.ok(supported, `${id}/${jutsu.id} cannot create a canonical persistent ground effect`);
        }
    }
});

test("authored encounters fail visibly on an unknown enemy template", () => {
    assert.throws(() => requireEnemyTemplate("misspelled-shadow"), /Unknown Battle Towers enemy template/);
});
