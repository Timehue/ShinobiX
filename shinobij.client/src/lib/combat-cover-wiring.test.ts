import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// A body-portaled fight covers the launching screen. Three things must stay
// tied together for the "hide what is covered" optimisation to be safe:
//   1. the paint rule targets <main class="center-game"> and nothing else;
//   2. every overlay that must show ABOVE a fight is rendered outside <main>;
//   3. the decorative frame loops pause on lib/combat-cover, except the fight's
//      own weather canvas, which lives inside the fight and must keep drawing.
const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("the paint rule hides only main.center-game while a CombatInstance is under <body>", () => {
    // In the always-loaded manifest, not the lazily-imported battle skin.
    const css = src("styles/index/30-combat-viewport-fit.css");
    assert.doesNotMatch(src("styles/battle-skin.css"), /main\.center-game \{\s*visibility: hidden/);
    assert.match(css, /body:has\(> \.arena-fullscreen\.combat-instance\) main\.center-game \{\s*visibility: hidden;\s*\}/);
    const instance = src("components/CombatInstance.tsx");
    assert.match(instance, /className=\{`arena-fullscreen combat-instance/, "the rule's anchor class is what CombatInstance renders");
    assert.match(instance, /createPortal\(combat, document\.body\)/, "the fight is a direct child of <body>");
});

test("every overlay that must float above a fight is rendered outside <main class=\"center-game\">", () => {
    const app = src("App.tsx");
    const mainOpen = app.indexOf('className={`center-game screen-${screen}');
    const mainClose = app.lastIndexOf("</main>");
    assert.ok(mainOpen > 0 && mainClose > mainOpen);
    for (const tag of ["<GameAlertHost />", "<GameConfirmHost />", "<GamePasswordPromptHost />", "<GameToastHost />", "<SaveErrorBanner", "<SessionExpiredModal", "<IncomingChallengeModal", "<StoryBossFightHost", "<AiFightHost"]) {
        const at = app.indexOf(tag);
        assert.ok(at > 0 && at < mainOpen, `${tag} renders before <main>`);
    }
    const toasts = app.indexOf("<ToastStacks");
    assert.ok(toasts > mainClose, "<ToastStacks renders after </main>");
});

test("the decorative frame loops pause on the combat cover; the fight's own weather canvas never does", () => {
    const ambience = src("components/SceneAmbience.tsx");
    assert.match(ambience, /from "\.\.\/lib\/combat-cover"/);
    assert.match(ambience, /const insideCombat = !!canvas\.closest\("\.combat-instance"\);/);
    assert.match(ambience, /insideCombat \? \(\) => \{\} : subscribeCombatCover\(/);
    const critters = src("components/SceneCritters.tsx");
    assert.match(critters, /subscribeCombatCover\(\(\) => \{ covered = isCoveredByCombat\(\); sync\(\); \}\)/);
    for (const scene of ["components/SceneAmbience3DScene.tsx", "components/SectorScene3DScene.tsx"]) {
        const source = src(scene);
        assert.match(source, /const covered = useCombatCover\(\);/, `${scene} reads the cover`);
        assert.match(source, /frameloop=\{covered \? "never" : "always"\}/, `${scene} stops its render loop while covered`);
        assert.doesNotMatch(source, /frameloop="always"/, `${scene} has no unconditional loop left`);
    }
});
