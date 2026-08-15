/*
 * Hunt beast portraits must stay reachable from the live World encounter
 * projection, not just the contract board. The authoritative fight host seals
 * identity on the server; WorldMap still owns the portrait presented before
 * that handoff and must prefer painted art to the emoji fallback.
 *
 * Static source/FS assertions rather than imports — hunter-art.ts imports .webp
 * files, which the node test runner cannot resolve.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const hunterArtSource = readFileSync(join(here, "hunter-art.ts"), "utf8");
const missionsSource = readFileSync(join(here, "missions.ts"), "utf8");

/** Keys of the BEAST_PORTRAITS record. */
function portraitKeys(): string[] {
    const block = hunterArtSource.split("const BEAST_PORTRAITS")[1]?.split("};")[0] ?? "";
    return [...block.matchAll(/"(hunt-ai-[a-z0-9-]+)"\s*:/g)].map((m) => m[1]);
}

/** `import name from "../assets/..."` pairs, so we can resolve each portrait to a file. */
function importedAssetPaths(): Map<string, string> {
    const pairs = new Map<string, string>();
    for (const m of hunterArtSource.matchAll(/import\s+(\w+)\s+from\s+"(\.\.\/assets\/[^"]+)"/g)) {
        pairs.set(m[1], m[2]);
    }
    return pairs;
}

/** aiProfileId of every builtin hunt mission. */
function huntAiProfileIds(): string[] {
    const block = missionsSource.split("builtinHuntMissions")[1]?.split("];")[0] ?? "";
    return [...block.matchAll(/aiProfileId:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("hunter-art beast portraits", () => {
    it("covers every builtin hunt mission's beast", () => {
        const keys = new Set(portraitKeys());
        const huntIds = huntAiProfileIds();

        assert.ok(huntIds.length >= 10, `expected the 10 builtin hunts, found ${huntIds.length}`);
        for (const id of huntIds) {
            assert.ok(
                keys.has(id),
                `No portrait for hunt beast "${id}". Arena would fall back to its emoji icon. ` +
                `Add it to BEAST_PORTRAITS in data/hunter-art.ts.`,
            );
        }
    });

    it("resolves each portrait to a file that actually exists", () => {
        const assets = importedAssetPaths();
        const block = hunterArtSource.split("const BEAST_PORTRAITS")[1]?.split("};")[0] ?? "";
        const entries = [...block.matchAll(/"(hunt-ai-[a-z0-9-]+)"\s*:\s*(\w+)\s*,/g)];

        // Guard against a vacuous pass if the record's shape ever changes.
        assert.equal(entries.length, portraitKeys().length, "portrait entry parse missed rows");
        assert.ok(entries.length >= 10, `parsed only ${entries.length} portrait entries`);

        for (const [, key, binding] of entries) {
            const relative = assets.get(binding);
            assert.ok(relative, `BEAST_PORTRAITS["${key}"] uses "${binding}", which is not an imported asset.`);
            assert.ok(
                existsSync(join(here, relative)),
                `Portrait for "${key}" points at a missing file: ${relative}`,
            );
        }
    });

    it("gives every Apex beast its OWN portrait, distinct from its base hunt", () => {
        // An Apex must not wear the same face as the ordinary hunt it escalates.
        const block = hunterArtSource.split("const BEAST_PORTRAITS")[1]?.split("};")[0] ?? "";
        const assets = importedAssetPaths();
        for (const beast of ["ember-drake", "moon-serpent", "ancient-chakra-beast", "worldstorm-dragon"]) {
            const apexBinding = block.match(new RegExp(`"apex-ai-${beast}"\\s*:\\s*(\\w+)`))?.[1];
            const baseBinding = block.match(new RegExp(`"hunt-ai-${beast}"\\s*:\\s*(\\w+)`))?.[1];
            assert.ok(apexBinding, `no portrait entry for apex-ai-${beast}`);
            assert.ok(baseBinding, `no portrait entry for hunt-ai-${beast}`);
            assert.notEqual(apexBinding, baseBinding, `apex-ai-${beast} reuses its base beast's art`);
            const rel = assets.get(apexBinding);
            assert.ok(rel, `apex-ai-${beast} maps to "${apexBinding}", not an imported asset`);
            assert.ok(existsSync(join(here, rel)), `apex-ai-${beast} points at a missing file: ${rel}`);
        }
    });

    it("keeps the apex→base fallback as a net for un-arted apex ids", () => {
        // Explicit keys win, but a future apex beast added before its portrait
        // exists must still not drop through to the emoji.
        assert.match(
            hunterArtSource,
            /startsWith\("apex-ai-"\)/,
            "beastPortrait lost its apex fallback",
        );
    });

    it("unwraps Endless Tower clone ids before the beast portrait lookup", () => {
        assert.match(hunterArtSource, /canonicalBeastPortraitId\(aiProfileId\)/);
    });

    it("ships an Apex banner for the contract card", () => {
        assert.match(hunterArtSource, /export const APEX_CONTRACT_BANNER/);
        const rel = importedAssetPaths().get("apexBanner");
        assert.ok(rel, "APEX_CONTRACT_BANNER has no imported asset");
        assert.ok(existsSync(join(here, rel)), `Apex banner missing on disk: ${rel}`);
    });

    it("is wired into the live World encounter projection above the emoji fallback", () => {
        const worldMap = readFileSync(join(here, "..", "screens", "WorldMap.tsx"), "utf8");
        assert.match(worldMap, /import\s*\{[^}]*beastPortrait[^}]*\}\s*from\s*"\.\.\/data\/hunter-art"/);
        assert.match(worldMap, /pack\.image = beast\.image \|\| beastPortrait\(beast\.id\)/,
            "hunt-pack presentation must retain painted beast art");
        assert.match(worldMap, /portrait=\{huntEncounter\.ai\.image \|\| beastPortrait\(huntEncounter\.ai\.id\)\}/,
            "the encounter card must prefer painted beast art before its icon fallback");
        assert.match(worldMap, /icon=\{huntEncounter\.ai\.icon\}/,
            "the emoji remains a final presentation fallback");
    });
});
