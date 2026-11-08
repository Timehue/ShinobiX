import { test } from "node:test";
import assert from "node:assert/strict";
import { bossFormView, createBossTransformationState, enterBossForms, type BossTransformationPlan } from "../../../shared/boss-transformations";
import { bossFormAuraClass, bossFormClosingLine } from "./boss-form-view";
import { beforeTransformation } from "./boss-form-reveal";

const form = (id: string, atHpPct: number, aura: "storm" | "flame") => ({
    id, atHpPct, formName: `${id} form`, aura, summary: `${id} summary.`,
    portrait: `/portraits/${id}.webp`, sprite: `/combat-actors/${id}.webp`,
    cutscene: { speaker: "Boss", lines: [`${id} line.`] },
});
const plan: BossTransformationPlan = { id: "reveal", phases: [form("second", 66, "storm"), form("third", 33, "flame")] };

test("until its cut-scene plays, the screen draws the boss as it was before transforming", () => {
    const state = createBossTransformationState(plan);
    enterBossForms(state, { name: "Boss", hp: 600, maxHp: 1000 }, 1);
    const first = bossFormView(state, 1, 600)!;
    assert.equal(first.portrait, "/portraits/second.webp");
    const before = beforeTransformation(first);
    assert.equal(before.portrait, undefined, "the base form's own art");
    assert.equal(before.sprite, undefined);
    assert.equal(bossFormAuraClass(before), "", "no aura yet");
    assert.equal(before.phase, 0);

    enterBossForms(state, { name: "Boss", hp: 300, maxHp: 1000 }, 2);
    const second = bossFormView(state, 2, 300)!;
    const beforeSecond = beforeTransformation(second);
    assert.equal(beforeSecond.portrait, "/portraits/second.webp", "a later form is preceded by the earlier one, not the base");
    assert.equal(beforeSecond.sprite, "/combat-actors/second.webp");
    assert.equal(beforeSecond.phase, 1);
    assert.match(bossFormAuraClass(second), /boss-form-aura--flame/);
});

test("a hit through several forms is preceded by the form before all of them", () => {
    const state = createBossTransformationState(plan);
    enterBossForms(state, { name: "Boss", hp: 100, maxHp: 1000 }, 1);
    const view = bossFormView(state, 1, 100)!;
    assert.deepEqual(view.skipped, ["second form"]);
    assert.equal(beforeTransformation(view).portrait, undefined, "the base art, not the skipped form");
    assert.match(bossFormClosingLine(view, "Boss"), /broke through second form/);
});
