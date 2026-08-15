import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(path.resolve(HERE, relative), "utf8");

test("Legacy mutations adopt the authoritative character and save version", () => {
    const api = source("./legacy.ts");
    const sage = source("../components/SageOfferModal.tsx");
    const emissary = source("../components/EmissaryTrialPanel.tsx");
    const panel = source("../screens/LegacyPanel.tsx");
    const world = source("../screens/WorldMap.tsx");
    const wandererDialog = source("../components/WorldWandererDialog.tsx");
    const profile = source("../screens/Profile.tsx");
    const app = source("../App.tsx");

    assert.equal((api.match(/character\?: Character/g) ?? []).length, 3);
    assert.equal((api.match(/_saveVersion\?: number/g) ?? []).length, 3);
    assert.match(api, /trialComplete\(playerName: string, trialId\?: string\)/);
    assert.match(api, /\.\.\.\(trialId \? \{ trialId \} : \{\}\)/);

    assert.match(sage, /onVersionedCharacter\(result\.character, result\._saveVersion\)/);
    assert.doesNotMatch(sage, /authoritative record did not arrive/);
    assert.match(emissary, /trialComplete\(playerName, trial\?\.id\)/);
    assert.match(emissary, /onVersionedCharacter\(r\.character, r\._saveVersion\)/);
    assert.match(panel, /trialComplete\(character\.name, status\?\.trial\?\.id\)/);
    assert.match(panel, /onVersionedCharacter\(result\.character, result\._saveVersion\)/);
    assert.match(api, /character\?: Character;[\s\S]*?_saveVersion\?: number;[\s\S]*?repaired\?: boolean;/,
        "ordinary Legacy status reads must expose an authoritative repair snapshot");
    assert.match(panel, /s\?\.character && typeof s\._saveVersion === "number"[\s\S]*?onVersionedCharacter\(s\.character, s\._saveVersion\) === false/,
        "LegacyPanel must atomically adopt or reject a status-triggered acceptance repair");
    assert.doesNotMatch(panel, /authoritative character record did not arrive/);
    assert.match(panel, /useEffect\(\(\) => \{\s*mountedRef\.current = true;[\s\S]*?return \(\) => \{\s*mountedRef\.current = false;/,
        "LegacyPanel must re-arm its mounted guard across React Strict Mode remounts");
    assert.match(panel, /if \(!mountedRef\.current \|\| request !== statusRequestRef\.current\) return;/);
    assert.ok((panel.match(/if \(!mountedRef\.current\) return;/g) ?? []).length >= 2,
        "Legacy action continuations must retire when their originating account unmounts");

    assert.match(world, /<SageOfferModal[\s\S]*?onVersionedCharacter=\{onVersionedCharacter\}/);
    assert.match(world, /<EmissaryTrialPanel[\s\S]*?onVersionedCharacter=\{onVersionedCharacter\}/);
    assert.match(world, /const wandererLegacyTrial = legacyAvailable && character\.legacy && wandererDialogEmissary/);
    assert.match(world, /legacyTrial=\{wandererLegacyTrial\}/);
    assert.match(wandererDialog, /\{legacyTrial\}/);
    assert.doesNotMatch(wandererDialog, /\b(?:EmissaryTrialPanel|onVersionedCharacter|trialComplete)\b/,
        "the wanderer card must render the projected trial without owning Legacy authority");
    assert.doesNotMatch(world, /onStageUp=/, "WorldMap must not reconstruct a partial Legacy snapshot");
    assert.match(profile, /<LegacyPanel[\s\S]*?key=\{character\.name\.trim\(\)\.toLowerCase\(\)\}[\s\S]*?onVersionedCharacter=\{onVersionedCharacter\}/);
    assert.doesNotMatch(profile, /onLegacyChanged=/, "Profile must not reconstruct a partial Legacy snapshot");
    assert.ok(
        (app.match(/onVersionedCharacter=\{commitVersionedCharacter\}/g) ?? []).length >= 2,
        "App must gate both WorldMap and Profile snapshots through version authority",
    );
});
