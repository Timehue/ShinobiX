import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shellSource = readFileSync(resolve(here, "../components/PetWarfrontRiteStage.tsx"), "utf8");
const stageSource = readFileSync(resolve(here, "../components/PetWarfrontRiteStage3D.tsx"), "utf8");
const rigSource = readFileSync(resolve(here, "../components/PetWarfrontSkinnedModel3D.tsx"), "utf8");
const riteSource = readFileSync(resolve(here, "../components/PetWarfrontRite.tsx"), "utf8");
const entrySource = readFileSync(resolve(here, "../petvfx.tsx"), "utf8");
const staticImports = [...stageSource.matchAll(/^import[\s\S]*?from\s+["']([^"']+)["'];/gm)].map((match) => match[1]);
const shellStaticImports = [...shellSource.matchAll(/^import[\s\S]*?from\s+["']([^"']+)["'];/gm)].map((match) => match[1]);

test("the default exact-model Canvas2D route has no static Three/R3F/rig edge", () => {
    assert.equal(shellStaticImports.some((edge) => /three|@react-three|PetWarfrontRiteStage3D|PetModel3D|pet-model-preload|pet-warfront-model-lod/iu.test(edge)), false);
    assert.match(shellSource, /import\("\.\/PetWarfrontRiteStage3D"\)/);
    assert.match(riteSource, /from "\.\/PetWarfrontRiteStage"/);
    assert.doesNotMatch(riteSource, /from "\.\/PetWarfrontRiteStage3D"/);
    assert.match(entrySource, /import\("\.\/petvfx-rite"\)/);
    assert.match(entrySource, /import\("\.\/petvfx-legacy"\)/);
});

test("the lightweight Warfront Stage has no static rig/GLTF/LOD/postprocessing edge", () => {
    assert.equal(staticImports.includes("./PetWarfrontSkinnedModel3D"), false);
    assert.equal(staticImports.includes("./PetModel3D"), false);
    assert.equal(staticImports.includes("../lib/pet-model-preload"), false);
    assert.equal(staticImports.includes("../lib/pet-warfront-model-lod"), false);
    assert.equal(staticImports.includes("../generated/pet-warfront-lod-manifest"), false);
    assert.equal(staticImports.includes("@react-three/drei"), false);
    assert.equal(staticImports.includes("@react-three/postprocessing"), false);
});

test("rig code is reachable only through an explicit dynamic boundary", () => {
    const dynamicEdges = stageSource.match(/import\("\.\/PetWarfrontSkinnedModel3D"\)/g) ?? [];
    assert.ok(dynamicEdges.length >= 2, "preload and mounted-route paths share the same async chunk");
    assert.match(rigSource, /from "\.\/PetModel3D"/);
    assert.match(rigSource, /from "\.\.\/lib\/pet-warfront-model-lod"/);
    const gate = stageSource.indexOf("if (!warfront3dQaCanaryRequested");
    const preloadImport = stageSource.indexOf('import("./PetWarfrontSkinnedModel3D")');
    assert.ok(gate >= 0 && gate < preloadImport, "the deployment preloader checks both QA flags before import()");
});
