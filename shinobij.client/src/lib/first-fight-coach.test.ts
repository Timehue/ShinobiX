import assert from "node:assert/strict";
import test from "node:test";
import {
    BAND_LINE_MAX_CHARS,
    BUBBLE_LINE_MAX_CHARS,
    EMPTY_FIRST_FIGHT_HISTORY,
    firstFightCoachLine,
    firstFightLessonForMission,
    firstFightLessonForStory,
    type FirstFightCoachHistory,
    type FirstFightCoachState,
} from "./first-fight-coach";

const opening: FirstFightCoachState = {
    lesson: "academySpar",
    round: 1,
    myTurn: true,
    myAp: 100,
    outOfActions: false,
    distance: 7,
    enemyInMelee: false,
    enemyHp: 300,
    enemyMaxHp: 300,
    enemyShield: 0,
    myDebuffs: [],
    canAttack: false,
    canMove: true,
    canCastJutsu: true,
    hasFlicker: true,
    hasKunai: true,
    fortyJutsu: { name: "Hematoma Veil", selfOnly: false, ready: true },
    cleanseReady: true,
    history: EMPTY_FIRST_FIGHT_HISTORY,
};

const line = (overrides: Partial<FirstFightCoachState>, seen: Set<string> = new Set()) =>
    firstFightCoachLine({ ...opening, ...overrides, history: { ...opening.history, ...(overrides.history ?? {}) } }, seen);

test("spar: a distant novice learns Move first, then the actual Attack control", () => {
    assert.match(line({})?.text ?? "", /^Move → tap a lit tile/);
    assert.match(line({ enemyInMelee: true, canAttack: true })?.text ?? "", /Tap Attack.*40 of your 100 AP/);
});

test("spar: after the first Attack the band names the 60 AP commitment, then AP running out", () => {
    const after = line({ enemyInMelee: true, canAttack: true, myAp: 60, history: { ...EMPTY_FIRST_FIGHT_HISTORY, attacked: true } });
    assert.match(after?.text ?? "", /Attack cost 40\. A jutsu costs 60/);
    const spent = line({ enemyInMelee: true, canAttack: false, canCastJutsu: false, myAp: 20, history: { ...EMPTY_FIRST_FIGHT_HISTORY, attacked: true } });
    assert.match(spent?.text ?? "", /20 AP left.*Tap Wait/);
});

test("every line fits its surface: one 10px phone band line, a three-line bubble", () => {
    // Enumerate every reachable line by sweeping the states the ladders branch on.
    const seen = new Set<string>();
    const texts = new Map<string, { text: string; surface: string }>();
    const histories: Array<Partial<FirstFightCoachHistory>> = [
        {}, { attacked: true }, { attacked: true, casted: true }, { casted: true },
        { castedSixtyIntoShield: true, enemyShieldSeen: true }, { enemyShieldSeen: true }, { castedSixtyWhilePoisoned: true },
        { casted: true, castedSixty: true },
    ];
    const lessons = ["academySpar", "eRankDrill", "storyFirst", "dRankErrand"] as const;
    for (const lesson of lessons) for (const history of histories) for (const myTurn of [true, false]) for (const distance of [7, 4, 1]) {
        for (const flags of [{}, { outOfActions: true }, { canMove: false, canCastJutsu: false }, { myAp: 20, canCastJutsu: false }, { enemyHp: 40 }]) {
            for (const extra of [
                {}, { myDebuffs: ["Decrease Damage Given"] }, { myDebuffs: ["Poison"] }, { enemyShield: 200 }, { hasFlicker: false }, { hasKunai: false },
                { fortyJutsu: { name: "Anvil Breath Guard", selfOnly: true, ready: true } }, { fortyJutsu: undefined }, { cleanseReady: false },
                { fortyJutsu: { name: "Hematoma Veil", selfOnly: false, ready: false } },
                { myAp: 40, fortyJutsu: { name: "Obsidian Afterglow", selfOnly: false, ready: true } },
            ]) {
                const result = line({ lesson, myTurn, distance, enemyInMelee: distance <= 1, canAttack: distance <= 1, ...flags, ...extra, history: { ...EMPTY_FIRST_FIGHT_HISTORY, ...history } }, seen);
                if (result) texts.set(result.id + "|" + result.text, { text: result.text, surface: result.surface });
            }
        }
    }
    assert.ok(texts.size >= 14, `sweep reached ${texts.size} distinct lines`);
    for (const { text, surface } of texts.values()) {
        const limit = surface === "band" ? BAND_LINE_MAX_CHARS : BUBBLE_LINE_MAX_CHARS;
        assert.ok(text.length <= limit, `${surface} line over budget (${text.length} > ${limit}): ${text}`);
    }
});

test("spar: unavailable actions never override turn or AP guidance, and victory silences it", () => {
    assert.match(line({ myTurn: false })?.text ?? "", /Dummy's turn/);
    assert.match(line({ outOfActions: true })?.text ?? "", /Tap Wait/);
    assert.match(line({ canMove: false, canCastJutsu: false })?.text ?? "", /Tap Wait/);
    assert.equal(line({ enemyHp: 0 }), null);
    assert.equal(line({})?.surface, "band");
});

test("drill: round one explains range, and the hex bubble fires once in the companion's voice", () => {
    const seen = new Set<string>();
    const first = line({ lesson: "eRankDrill" }, seen);
    assert.equal(first?.surface, "band");
    assert.match(first?.text ?? "", /Flicker in for 20/);
    assert.match(line({ lesson: "eRankDrill", hasFlicker: false })?.text ?? "", /Step in/);
    assert.match(line({ lesson: "eRankDrill", distance: 4, hasKunai: false })?.text ?? "", /A jutsu is 60 AP/);
    assert.match(line({ lesson: "eRankDrill", distance: 4 })?.text ?? "", /kunai 40/);
    const hexed = line({ lesson: "eRankDrill", round: 2, distance: 4, myDebuffs: ["Decrease Damage Given"] }, seen);
    assert.equal(hexed?.surface, "bubble");
    assert.match(hexed?.text ?? "", /Hematoma Veil does the same to it for forty/);
    seen.add(hexed!.id);
    const again = line({ lesson: "eRankDrill", round: 2, distance: 4, myDebuffs: ["Decrease Damage Given"] }, seen);
    assert.notEqual(again?.id, "drill-hexed", "a once-only bubble yields to the band after it has been shown");
    assert.equal(again?.surface, "band");
    const selfBuff = line({ lesson: "eRankDrill", myDebuffs: ["Decrease Damage Given"], fortyJutsu: { name: "Anvil Breath Guard", selfOnly: true, ready: true } });
    assert.match(selfBuff?.text ?? "", /Anvil Breath Guard costs forty and steadies you/);
    const noForty = line({ lesson: "eRankDrill", myDebuffs: ["Decrease Damage Given"], fortyJutsu: undefined });
    assert.match(noForty?.text ?? "", /fades in two turns/);
    // Seen live 2026-09-17: the player had already spent Hematoma Veil on it,
    // so the card was on cooldown when the hex landed. The bubble must not
    // suggest pressing it.
    const spent = line({ lesson: "eRankDrill", myDebuffs: ["Decrease Damage Given"], fortyJutsu: { name: "Hematoma Veil", selfOnly: false, ready: false } });
    assert.match(spent?.text ?? "", /the way your Hematoma Veil hexed it/);
    assert.doesNotMatch(spent?.text ?? "", /still leaves you sixty/);
    const spentSelf = line({ lesson: "eRankDrill", myDebuffs: ["Decrease Damage Given"], fortyJutsu: { name: "Anvil Breath Guard", selfOnly: true, ready: false } });
    assert.match(spentSelf?.text ?? "", /fades in two turns/);
    assert.doesNotMatch(spentSelf?.text ?? "", /Anvil Breath Guard/);
});

test("drill: nothing is said off-turn, and the band goes quiet once the player has cast", () => {
    assert.equal(line({ lesson: "eRankDrill", myTurn: false }), null);
    assert.equal(line({ lesson: "eRankDrill", round: 3, distance: 3, history: { ...EMPTY_FIRST_FIGHT_HISTORY, casted: true } }), null);
});

test("drill: after a heavy cast leaves exactly the cheap technique's AP, the band says it fits", () => {
    const fits = line({ lesson: "eRankDrill", distance: 4, myAp: 40, history: { ...EMPTY_FIRST_FIGHT_HISTORY, casted: true, castedSixty: true } });
    assert.equal(fits?.text, "Hematoma Veil fits your 40 AP. Or Wait.");
    assert.equal(line({ lesson: "eRankDrill", distance: 4, myAp: 40, fortyJutsu: { name: "Hematoma Veil", selfOnly: false, ready: false }, history: { ...EMPTY_FIRST_FIGHT_HISTORY, casted: true, castedSixty: true } }), null, "never points at a technique on cooldown");
    assert.equal(line({ lesson: "eRankDrill", distance: 4, myAp: 100, history: { ...EMPTY_FIRST_FIGHT_HISTORY, casted: true, castedSixty: true } }), null);
});

test("story: the braced guardian gets exactly three light cut-ins, in order, once each", () => {
    const seen = new Set<string>();
    const braced = line({ lesson: "storyFirst", enemyShield: 267 }, seen);
    assert.equal(braced?.id, "story-braced");
    assert.match(braced?.text ?? "", /It's braced/);
    seen.add(braced!.id);
    const wasted = line({ lesson: "storyFirst", enemyShield: 100, history: { ...EMPTY_FIRST_FIGHT_HISTORY, castedSixtyIntoShield: true, enemyShieldSeen: true } }, seen);
    assert.equal(wasted?.id, "story-wasted");
    seen.add(wasted!.id);
    const open = line({ lesson: "storyFirst", enemyShield: 0, history: { ...EMPTY_FIRST_FIGHT_HISTORY, enemyShieldSeen: true } }, seen);
    assert.equal(open?.id, "story-open");
    assert.match(open?.text ?? "", /Guard's down/);
    seen.add(open!.id);
    assert.equal(line({ lesson: "storyFirst", enemyShield: 0, history: { ...EMPTY_FIRST_FIGHT_HISTORY, enemyShieldSeen: true } }, seen), null);
    // Before any shield has shown there is nothing to say.
    assert.equal(line({ lesson: "storyFirst" }), null);
});

test("errand: the poison line is honest about the choice and the second only fires after a taxed heavy cast", () => {
    const seen = new Set<string>();
    const poisoned = line({ lesson: "dRankErrand", myDebuffs: ["Poison", "Increase Damage Taken"] }, seen);
    assert.equal(poisoned?.id, "errand-poisoned");
    assert.match(poisoned?.text ?? "", /Cleanse clears it, or end this fast/);
    seen.add(poisoned!.id);
    assert.equal(line({ lesson: "dRankErrand", myDebuffs: ["Poison"] }, seen), null, "no nagging while the player has not cast through it");
    const bite = line({ lesson: "dRankErrand", myDebuffs: ["Poison"], history: { ...EMPTY_FIRST_FIGHT_HISTORY, castedSixtyWhilePoisoned: true } }, seen);
    assert.equal(bite?.id, "errand-bite");
    assert.equal(line({ lesson: "dRankErrand", myDebuffs: ["Poison"], cleanseReady: false, history: { ...EMPTY_FIRST_FIGHT_HISTORY, castedSixtyWhilePoisoned: true } }, seen), null, "never points at a Cleanse the player cannot press");
    assert.equal(line({ lesson: "dRankErrand" }, seen), null);
});

test("who gets coached: first meeting only, Academy rank only, chapter one only", () => {
    const rookie = { level: 1, defeatedAiIds: [] as string[], storyProgress: 0 };
    assert.equal(firstFightLessonForMission({ key: "combat-e-drill", aiProfileId: "builtin-ai-academy-sparring" }, rookie), "eRankDrill");
    assert.equal(firstFightLessonForMission({ key: "combat-d-errand", aiProfileId: "builtin-ai-mist-sentinel" }, { ...rookie, level: 5 }), "dRankErrand");
    assert.equal(firstFightLessonForMission({ key: "combat-c-patrol", aiProfileId: "builtin-ai-ember-duelist" }, rookie), undefined);
    assert.equal(firstFightLessonForMission({ key: "combat-e-drill", aiProfileId: "builtin-ai-academy-sparring" }, { ...rookie, defeatedAiIds: ["builtin-ai-academy-sparring"] }), undefined, "a repeat run is play, not a lesson");
    assert.equal(firstFightLessonForMission({ key: "combat-e-drill", aiProfileId: "builtin-ai-academy-sparring" }, { ...rookie, level: 15 }), undefined, "a Genin is left alone");
    assert.equal(firstFightLessonForStory(rookie), "storyFirst");
    assert.equal(firstFightLessonForStory({ ...rookie, storyProgress: 1 }), undefined);
    assert.equal(firstFightLessonForStory({ ...rookie, level: 40 }), undefined);
});
