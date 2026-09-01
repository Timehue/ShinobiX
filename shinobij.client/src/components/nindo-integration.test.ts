import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const editor = read("shinobij.client/src/components/NindoEditor.tsx");
const profile = read("shinobij.client/src/screens/Profile.tsx");
const app = read("shinobij.client/src/App.tsx");
const backgrounds = read("shinobij.client/src/lib/nindo-backgrounds.ts");
const saveHandler = read("api/save/[name].ts");
const roster = read("api/player/roster.ts");
const userView = read("shinobij.client/src/screens/UserView.tsx");

test("Profile feeds both Nindo fields into the editor and writes them through character state", () => {
    assert.match(profile, /<NindoEditor[\s\S]*?value=\{\{ nindo: character\.nindo \?\? "", nindoBg: character\.nindoBg \}\}/);
    assert.match(profile, /onSave=\{\(v\) => updateCharacter\(\(prev\) => prev \? \{ \.\.\.prev, \.\.\.v \} : prev\)\}/);
    assert.match(app, /screen === "profile"[\s\S]*?<Profile[\s\S]*?updateCharacter=\{setCharacter\}/);
    assert.match(app, /if \(character !== prevCharRef\.current\) \{[\s\S]*?charDirtyRef\.current = true;/);
});

test("Clear removes both the creed and banner, and clean editors adopt server snapshots", () => {
    assert.match(editor, /useEffect\(\(\) => \{\s*if \(dirty\) return;\s*setDraft\(value\.nindo \?\? ""\);\s*setBg\(value\.nindoBg \?\? ""\);/s);
    assert.match(editor, /function clear\(\) \{\s*setDraft\(""\);\s*setBg\(""\);\s*onSave\(\{ nindo: "", nindoBg: "" \}\);/s);
});

test("client and server Nindo banner allowlists stay in exact parity", () => {
    const clientIds = [...backgrounds.matchAll(/\bid:\s*"([^"]*)"/g)].map((match) => match[1]);
    const serverList = saveHandler.match(/NINDO_BG_IDS = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
    const serverIds = [...serverList.matchAll(/'([^']*)'/g)].map((match) => match[1]);

    assert.deepEqual(serverIds, clientIds);
    assert.ok(clientIds.length > 1, "expected the Nindo background registry to contain presets");
});

test("saved Nindo fields survive the public roster projection and render in UserView", () => {
    assert.match(saveHandler, /if \('nindo' in char\)[\s\S]*?char\.nindo = v;/);
    assert.match(saveHandler, /if \('nindoBg' in char\)[\s\S]*?char\.nindoBg =/);
    assert.match(roster, /for \(const k of \['nindo', 'nindoBg'\]\)/);
    assert.match(userView, /<NindoCard nindo=\{viewedCharacter\.nindo\} nindoBg=\{viewedCharacter\.nindoBg\}/);
});
