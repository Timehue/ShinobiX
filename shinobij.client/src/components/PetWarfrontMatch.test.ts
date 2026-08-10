import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { councilCartCost, councilPackageChoices, visiblePackageActivationLabel } from "../lib/pet-warfront-council.ts";
import {
    firstViableWarfrontChoice,
    WARFRONT_PACKAGE_ROLE,
    WARFRONT_TECHNIQUE_ROLE,
} from "../lib/warfront-council-roles.ts";

const stacks = { strike: 0, guard: 0, vitality: 0, swift: 0, mend: 0 } as const;
const costs = { strike: 120, guard: 120, vitality: 120, swift: 120, mend: 120 } as const;
const buyState = [
    { petId: "blue-0", petName: "Anchor", role: "defender" as const, stacks: { ...stacks }, costs: { ...costs } },
    { petId: "blue-1", petName: "Hunter", role: "assassin" as const, stacks: { ...stacks }, costs: { ...costs } },
    { petId: "blue-2", petName: "Scout", role: "tracker" as const, stacks: { ...stacks }, costs: { ...costs } },
    { petId: "blue-3", petName: "Sage", role: "sage" as const, stacks: { ...stacks }, costs: { ...costs } },
];

test("Council packages select only the affordable priority prefix", () => {
    const none = councilPackageChoices(buyState, "hold-line", 0);
    const one = councilPackageChoices(buyState, "hold-line", 120);
    const two = councilPackageChoices(buyState, "hold-line", 240);

    assert.deepEqual(none, []);
    assert.deepEqual(one, [{ petIndex: 0, kind: "guard" }]);
    assert.deepEqual(two, [{ petIndex: 0, kind: "guard" }, { petIndex: 0, kind: "vitality" }]);
    assert.equal(councilCartCost(buyState, none), 0);
    assert.equal(councilCartCost(buyState, one), 120);
    assert.equal(councilCartCost(buyState, two), 240);
});

test("receipt labels throttled package events as visible activations, not total procs", () => {
    assert.equal(visiblePackageActivationLabel(0), "0 visible activations");
    assert.equal(visiblePackageActivationLabel(1), "1 visible activation");
    assert.equal(visiblePackageActivationLabel(4), "4 visible activations");
});

test("snapshot render indexes cannot retain timelines across restart or reseed", () => {
    const source = readFileSync(new URL("./PetWarfrontMatch.tsx", import.meta.url), "utf8");
    assert.match(source, /const wfSnapshotIndexes = new WeakMap<WfSnapshot, WfSnapshotIndex>\(\)/);
    assert.match(source, /const wfPetStrikeIndexes = new WeakMap<WarfrontResult, WfPetStrikeIndex>\(\)/);
    assert.doesNotMatch(source, /wfSnapshotIndexes\.(?:size|keys)\b/);
});

test("Council role gates cover every package and objective specialist", () => {
    assert.deepEqual(WARFRONT_PACKAGE_ROLE, {
        "hold-line": "defender",
        "blood-hunt": "assassin",
        "escort-rite": "sage",
    });
    assert.deepEqual(WARFRONT_TECHNIQUE_ROLE, {
        secure: "tracker",
        hijack: "assassin",
        zone: "defender",
    });
    assert.equal(
        firstViableWarfrontChoice("blood-hunt", ["hold-line", "blood-hunt", "escort-rite"], WARFRONT_PACKAGE_ROLE, new Set(["sage"] as const)),
        "escort-rite",
        "recommendations must fall back to a package the roster can activate",
    );
    assert.equal(
        firstViableWarfrontChoice("secure", ["secure", "hijack", "zone"], WARFRONT_TECHNIQUE_ROLE, new Set(["defender"] as const)),
        "zone",
        "objective recommendations must never advertise a missing specialist",
    );
});

test("Council auth failure always retains an authenticated escape path and focus recovery", () => {
    const source = readFileSync(new URL("./PetWarfrontMatch.tsx", import.meta.url), "utf8");
    assert.match(source, /if \(event\.key === "Escape"\)[\s\S]*?onRequestExit\(\)/);
    const exitButton = source.match(/<button className="wf-council-exit"[^>]*>/)?.[0] ?? "";
    assert.ok(exitButton, "Council must render its own exit control");
    assert.doesNotMatch(exitButton, /disabled=/, "pending or failed Council authorization must not trap the player");
    assert.match(source, /submitError \? "Retry same decisions"/);
    assert.match(source, /previous\?\.isConnected/);
    assert.match(source, /onRequestExit=\{requestExit\}/, "Escape and the visible control must share the authenticated forfeit confirmation path");
    assert.match(source, /authenticated match contract lasts 60 minutes/);
    assert.match(source, /Holding the Council timer does not extend it; Forfeit &amp; exit remains available/);

    const forfeitFlow = source.slice(source.indexOf("const confirmForfeit = async"), source.indexOf("const btn:", source.indexOf("const confirmForfeit = async")));
    assert.match(forfeitFlow, /await onForfeit\(\)/, "the parent must confirm a terminal or safely expired server receipt");
    assert.match(forfeitFlow, /setExitError\(/, "a failed or expired authorization must keep recovery controls visible");
    assert.doesNotMatch(forfeitFlow, /onExit\(/, "Match must not locally close before the authenticated callback accepts the terminal outcome");
});

test("Warfront warm preload has no artificial post-countdown delay or HEAD waterfall", () => {
    const source = readFileSync(new URL("./PetWarfrontMatch.tsx", import.meta.url), "utf8");
    const preloadSource = readFileSync(new URL("../lib/pet-model-preload.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /method:\s*"HEAD"/);
    assert.doesNotMatch(source, /650\s*-\s*\(performance\.now/);
    assert.match(source, /if \(!cancelled\) setAssetsReady\(true\)/);
    assert.match(preloadSource, /export async function preloadPetWarfrontModels/);
    for (const url of ["gate-warden-rigged.glb", "ward-totem.glb", "wf-boulder.glb", "wf-lantern.glb"]) assert.match(preloadSource, new RegExp(url.replace(".", "\\.")));
});

test("reduced motion freezes the decorative Gate and Ward Seals", () => {
    const source = readFileSync(new URL("./PetWarfrontMatch.tsx", import.meta.url), "utf8");
    assert.match(source, /function WfHollowGate\(\{ glow, reducedMotion \}/);
    assert.match(source, /const now = reducedMotion \? 0 : state\.clock\.elapsedTime/);
    assert.match(source, /!reducedMotion && <Sparkles count=\{26\}/);
    assert.match(source, /gem\.current\.rotation\.y = reducedMotion \? 0/);
});

test("mobile override rules retain all four safe-area insets", () => {
    const source = readFileSync(new URL("./PetWarfrontMatch.tsx", import.meta.url), "utf8");
    const adaptive = readFileSync(new URL("../styles/layout/adaptive-stages.css", import.meta.url), "utf8");
    for (const inset of ["top", "right", "bottom", "left"]) {
        assert.match(source, new RegExp(`safe-area-inset-${inset}`));
        assert.match(adaptive, new RegExp(`safe-area-inset-${inset}`));
    }
    assert.doesNotMatch(source, /\.wf-top-controls\{top:8px!important;left:8px!important/);
});

test("imperative Warfront objects dispose only resources they own", () => {
    const source = readFileSync(new URL("./PetWarfrontMatch.tsx", import.meta.url), "utf8");
    assert.match(source, /Geometry and textures belong to useGLTF's shared cache/);
    assert.match(source, /mesh\.dispose\(\)/);
    assert.match(source, /canopyMesh\.traverse\([\s\S]{0,350}mesh\.dispose\(\)/);
    assert.match(source, /WfArtGlb creates its own lifted presentation material/);
    assert.doesNotMatch(source, /prepared\.traverse[\s\S]{0,500}geometry\.dispose\(\)/);
    assert.match(source, /<TransientFx3DLayer apiRef=\{transientFxRef\}/);
});
