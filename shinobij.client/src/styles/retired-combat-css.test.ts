import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

const clientRoot = join(process.cwd(), "shinobij.client");
const sourceRoot = join(clientRoot, "src");
const textExtensions = new Set([
    ".cjs", ".ejs", ".hbs", ".htm", ".html", ".js", ".json", ".jsx",
    ".mjs", ".svg", ".ts", ".tsx", ".txt", ".xml",
]);
const retiredClassFamily = /\b(?:hex-zoom-|story-journey-|story-fight-portal\b|pet-arena-party(?:\b|-)|pvp-(?:rich-|log-|round-|block-|actor-|effect-|uses-text\b|jutsu-name\b|victory-text\b)|tower-action-(?:deck|status|resources)\b|tower-fight-(?:objective|round|zoom)\b)/;
const retiredWorldMapDrawingClass = /\b(?:sea-label|sea-(?:north|east|south)|atlas-landmass|continent-(?:west|east)|frozen-north|island-south|atlas-region-label|label-(?:volcano|forest|fire|ice))\b/;

function filesUnder(root: string, accept: (path: string) => boolean): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) return filesUnder(path, accept);
        return entry.isFile() && accept(path) ? [path] : [];
    });
}

function isProductionText(path: string): boolean {
    if (!textExtensions.has(extname(path).toLowerCase())) return false;
    return !/\.(?:test|spec)\.[^.]+$/i.test(path);
}

test("retired combat selector families stay ownerless and absent from shipped CSS", () => {
    const productionText = [
        ...filesUnder(sourceRoot, isProductionText),
        ...filesUnder(join(clientRoot, "public"), isProductionText),
        join(clientRoot, "index.html"),
    ].filter(existsSync);
    const sourceOffenders = productionText.flatMap((path) => {
        const match = readFileSync(path, "utf8").match(retiredClassFamily);
        return match ? [`${relative(clientRoot, path)}: ${match[0]}`] : [];
    });
    assert.deepEqual(sourceOffenders, [], "a retired class family gained a production owner");

    const cssOffenders = filesUnder(sourceRoot, (path) => extname(path).toLowerCase() === ".css")
        .flatMap((path) => {
            const match = readFileSync(path, "utf8").match(retiredClassFamily);
            return match ? [`${relative(clientRoot, path)}: ${match[0]}`] : [];
        });
    assert.deepEqual(cssOffenders, [], "retired ownerless selectors must not return to shipped CSS");
});

test("retired world-map drawing classes stay ownerless and absent from shipped CSS", () => {
    const productionText = [
        ...filesUnder(sourceRoot, isProductionText),
        ...filesUnder(join(clientRoot, "public"), isProductionText),
        join(clientRoot, "index.html"),
    ].filter(existsSync);
    const sourceOffenders = productionText.flatMap((path) => {
        const match = readFileSync(path, "utf8").match(retiredWorldMapDrawingClass);
        return match ? [`${relative(clientRoot, path)}: ${match[0]}`] : [];
    });
    assert.deepEqual(sourceOffenders, [], "a retired world-map drawing class gained a production owner");

    const cssOffenders = filesUnder(sourceRoot, (path) => extname(path).toLowerCase() === ".css")
        .flatMap((path) => {
            const match = readFileSync(path, "utf8").match(retiredWorldMapDrawingClass);
            return match ? [`${relative(clientRoot, path)}: ${match[0]}`] : [];
        });
    assert.deepEqual(cssOffenders, [], "retired world-map drawing selectors must not return to shipped CSS");

    const chartingCss = readFileSync(join(sourceRoot, "components", "world-map-charting.css"), "utf8");
    assert.match(chartingCss, /\.world-region-label\s*\{/);
    assert.match(chartingCss, /\.world-poi-plate\s*\{/);
});

test("the Story archive interlude modifier remains tied to its typed dynamic owner", () => {
    const journey = readFileSync(join(sourceRoot, "components", "StoryJourney.tsx"), "utf8");
    const archive = readFileSync(join(sourceRoot, "lib", "story-archive.ts"), "utf8");
    const battleSkin = readFileSync(join(sourceRoot, "styles", "battle-skin.css"), "utf8");

    assert.match(journey, /story-archive-entry is-\$\{entry\.kind\}/);
    assert.match(archive, /kind:\s*"chapter"\s*\|\s*"interlude"/);
    assert.match(archive, /kind:\s*"interlude"/);
    assert.match(battleSkin, /\.story-archive-entry\.is-interlude\s*\{/);
});
