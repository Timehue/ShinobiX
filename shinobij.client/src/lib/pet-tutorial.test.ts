import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { Character } from "../types/character";
import {
    PET_TUTORIAL_LESSONS,
    completePetTutorialLesson,
    nextPetTutorialLesson,
    personalizePetTutorialText,
    petTutorialLessonAvailable,
} from "./pet-tutorial";
import { PET_MENTOR_WANDERER_ID, petMentorWandererFor } from "./pet-tutorial-mentor";
import { PET_TUTORIAL_UNLOCKS } from "../../../shared/pet-tutorial";

function character(level: number, petCount: number, completedLessonIds: string[] = []) {
    return {
        level,
        pets: Array.from({ length: petCount }, (_, index) => ({ id: `pet-${index}`, name: `Pet ${index + 1}` })),
        petTutorialProgress: { version: 1, completedLessonIds },
    } as unknown as Pick<Character, "level" | "pets" | "petTutorialProgress">;
}

describe("Tamer Tomoe curriculum", () => {
    it("keeps the full course structurally complete and synchronized with the lightweight unlock schedule", () => {
        assert.equal(PET_TUTORIAL_LESSONS.length, PET_TUTORIAL_UNLOCKS.length);
        const pageTitles = new Set<string>();
        PET_TUTORIAL_LESSONS.forEach((lesson, index) => {
            const unlock = PET_TUTORIAL_UNLOCKS[index];
            assert.deepEqual(
                { id: lesson.id, minLevel: lesson.minLevel, minPets: lesson.minPets, shortTitle: lesson.shortTitle },
                unlock,
                `${lesson.id} must not drift from the World Map schedule`,
            );
            assert.equal(lesson.order, index + 1);
            assert.ok(lesson.pages.length >= 3, `${lesson.id} needs a complete multi-page lesson`);
            assert.ok(lesson.summary.trim().length >= 60, `${lesson.id} needs an explanatory summary`);
            lesson.pages.forEach((page) => {
                assert.ok(page.body.trim().length >= 140, `${page.title} needs a full explanation`);
                assert.ok(page.points.length >= 3, `${page.title} needs actionable takeaways`);
                assert.equal(pageTitles.has(page.title), false, `duplicate page title: ${page.title}`);
                pageTitles.add(page.title);
            });
        });
    });

    it("paces lessons by the existing level bands and actual roster size", () => {
        const byId = Object.fromEntries(PET_TUTORIAL_LESSONS.map((lesson) => [lesson.id, lesson]));
        assert.equal(petTutorialLessonAvailable(byId.bond, character(2, 1)), true);
        assert.equal(petTutorialLessonAvailable(byId.party, character(15, 1)), false, "2v2 is not taught to a one-pet roster");
        assert.equal(petTutorialLessonAvailable(byId.party, character(15, 2)), true);
        assert.equal(petTutorialLessonAvailable(byId.warfront, character(30, 3)), false, "Warfront keeps its four-pet field requirement");
        assert.equal(petTutorialLessonAvailable(byId.warfront, character(30, 4)), true);
        assert.equal(petTutorialLessonAvailable(byId.gauntlet, character(39, 6)), false);
        assert.equal(petTutorialLessonAvailable(byId.gauntlet, character(40, 1)), true);
    });

    it("makes Kuro's second tail explicit Bondwake lore rather than an unexplained visual", () => {
        const bondwake = PET_TUTORIAL_LESSONS[0].pages.find((page) => page.title.includes("two tails"));
        assert.ok(bondwake);
        assert.match(bondwake.body, /born with one tail/i);
        assert.match(bondwake.body, /mature shinobi bond/i);
        assert.match(bondwake.body, /second/i);
        assert.match(bondwake.points.join(" "), /no hidden stat bonus/i);

        const [firstVisit] = petMentorWandererFor(character(2, 1), 12);
        assert.match(firstVisit.greeting, /second tail/i);
    });

    it("offers the next usable unfinished lesson without blocking on a missing roster prerequisite", () => {
        const onePetVeteran = character(25, 1, ["bond", "showdown", "colosseum"]);
        assert.equal(nextPetTutorialLesson(onePetVeteran)?.id, "ladder", "locked 2v2 does not hide the usable ladder chapter");
        const withPartner = character(25, 2, ["bond", "showdown", "colosseum"]);
        assert.equal(nextPetTutorialLesson(withPartner)?.id, "party");
    });

    it("Tomoe returns for an unlocked chapter and retires when every available chapter is complete", () => {
        const learner = character(5, 1, ["bond"]);
        const found = petMentorWandererFor(learner, 12);
        assert.equal(found.length, 1);
        assert.equal(found[0].id, PET_MENTOR_WANDERER_ID);
        assert.match(found[0].greeting, /showdown/i);

        const done = { ...learner, petTutorialProgress: completePetTutorialLesson(learner.petTutorialProgress, "showdown") };
        assert.deepEqual(petMentorWandererFor(done, 12), []);
    });

    it("keeps Tomoe's route inside the 12 by 12 sector grid", () => {
        for (let sector = 1; sector <= 60; sector += 1) {
            const [tomoe] = petMentorWandererFor(character(40, 4), sector);
            assert.ok(tomoe);
            for (const tile of [tomoe.homeTile, ...tomoe.waypoints]) {
                assert.ok(tile >= 0 && tile < 144, `sector ${sector} produced invalid tile ${tile}`);
            }
        }
        assert.deepEqual(petMentorWandererFor(character(40, 4), null), []);
    });

    it("personalizes lesson copy with the active companion rather than roster order", () => {
        const copy = personalizePetTutorialText("{pet} answers with {element} chakra.", {
            activePetId: "second",
            pets: [
                { id: "first", name: "First", element: "Fire" },
                { id: "second", name: "Kuro", element: "Wind" },
            ],
        } as Pick<Character, "pets" | "activePetId">);
        assert.equal(copy, "Kuro answers with Wind chakra.");
    });

    it("completion is idempotent", () => {
        const once = completePetTutorialLesson(undefined, "bond");
        const twice = completePetTutorialLesson(once, "bond");
        assert.deepEqual(twice.completedLessonIds, ["bond"]);
    });
});

describe("Warfront lesson content", () => {
    it("teaches the Rite, not the retired lane war", () => {
        // The tutorial is how a player LEARNS the mode, so stale copy here is
        // worse than stale copy anywhere else: it teaches rules that no longer
        // exist. The lane war (three lanes, Ward Towers, Favor, the Gate Warden,
        // 2-1-1 deployment) was replaced by four-a-side clashes — see
        // docs/hollow-warfront-rite.md.
        const lesson = PET_TUTORIAL_LESSONS.find((entry) => entry.id === "warfront");
        assert.ok(lesson, "the Warfront lesson must exist");
        const text = JSON.stringify(lesson);
        for (const retired of ["Ward Tower", "Gate Warden", "sealed lanes", "three lanes", "Favor", "doctrine", "redirect"]) {
            assert.equal(text.includes(retired), false, `the Warfront lesson still teaches "${retired}"`);
        }
        // And it must actually teach what decides a Rite.
        const lower = text.toLowerCase();
        for (const current of ["front line", "clash"]) {
            assert.ok(lower.includes(current), `the Warfront lesson never mentions "${current}"`);
        }
    });
});
