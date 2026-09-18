/*
 * Every R3F <Canvas> must retire its renderer (lib/three-renderer-retirement).
 *
 * The leak this guards is invisible on a dev machine: a canvas without the
 * guard renders perfectly and frees its GPU memory, and only a heap snapshot
 * shows the dead renderer, its WebGL context and its detached DOM still alive
 * after every mount. It took a forced-GC measurement to see it at all, so a
 * twelfth canvas added next month would bring it straight back unnoticed.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Files that render a <Canvas> and are deliberately not wired, with the reason.
const EXEMPT = new Map<string, string>([
    ["components/PetWarfrontRiteStage3D.tsx", "owns the original of this guard (RendererContextGuard + pet-warfront-renderer-lifecycle)"],
    ["components/PetModelQa.tsx", "QA-only entry, never part of the production app"],
    ["pet-model-lifecycle-preview.tsx", "QA-only entry, never part of the production app"],
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) sourceFiles(full, out);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
}

// Comments are stripped first: prose that says "<Canvas>" or "useTexture" is not a
// canvas or a call. JSX comments are block comments, so the one pattern covers them.
const files = sourceFiles(srcDir).map(full => ({
    rel: path.relative(srcDir, full).replace(/\\/g, "/"),
    text: readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/[^\n]*/g, "$1"),
}));
const importsCanvas = (text: string) => /import\s*\{[^}]*\bCanvas\b[^}]*\}\s*from\s*["']@react-three\/fiber["']/.test(text);

test("every file that renders an R3F <Canvas> mounts <RendererRetirement />", () => {
    const canvasFiles = files.filter(file => importsCanvas(file.text));
    assert.ok(canvasFiles.length >= 12, `expected to find the known canvases, found ${canvasFiles.length}`);
    const unwired = canvasFiles
        .filter(file => !EXEMPT.has(file.rel))
        .filter(file => {
            const canvases = file.text.match(/<Canvas[\s>]/g)?.length ?? 0;
            const guards = file.text.match(/<RendererRetirement\s*\/>/g)?.length ?? 0;
            return guards < canvases;
        })
        .map(file => file.rel);
    assert.deepEqual(unwired, [], "add <RendererRetirement /> as the first child of each <Canvas> in these files");
});

test("exemptions still exist and still render a canvas", () => {
    for (const [rel, reason] of EXEMPT) {
        const file = files.find(candidate => candidate.rel === rel);
        assert.ok(file, `${rel} is exempt (${reason}) but no longer exists — drop the exemption`);
        assert.ok(importsCanvas(file.text), `${rel} is exempt (${reason}) but no longer renders a <Canvas>`);
    }
});

test("no production file uses drei's useTexture", () => {
    // useTexture uploads the loader's cached ORIGINAL to the GPU on every canvas.
    // Both former call sites drew only a colour-space-corrected clone, so that
    // was a second, never-drawn copy of the image in video memory, bound to a
    // texture no scene contains — which the retirement guard therefore cannot
    // see. useLoader(THREE.TextureLoader, url) shares the same cache entry and
    // the same Suspense behaviour without the eager upload.
    const offenders = files
        .filter(file => !EXEMPT.has(file.rel))
        .filter(file => /\buseTexture\b/.test(file.text))
        .map(file => file.rel);
    assert.deepEqual(offenders, [], "use useLoader(THREE.TextureLoader, url) and clone, as SectorScene3DScene does");
});
