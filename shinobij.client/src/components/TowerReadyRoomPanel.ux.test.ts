import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("./TowerReadyRoomPanel.tsx", import.meta.url), "utf8");
const lobby = readFileSync(new URL("../screens/BattleTowersLobby.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/tower-lobby.css", import.meta.url), "utf8");

test("Ready Room presents distinct host, join, current-squad, and secondary-invitation states", () => {
    assert.match(panel, /aria-labelledby="tower-ready-room-host-title"/);
    assert.match(panel, /aria-labelledby="tower-ready-room-join-title"/);
    assert.match(panel, /id="tower-ready-room-squad-title"/);
    assert.match(panel, /<details className="tower-ready-room-other-invitations">/);
    assert.match(panel, /Leave this room before accepting another squad\./);
    assert.match(panel, /Array\.from\(\{ length: openSlotCount \}/);
    assert.match(css, /\.tower-ready-room-paths\s*\{[\s\S]{0,140}?grid-template-columns:\s*repeat\(2/);
    assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.tower-ready-room-paths,[\s\S]{0,90}?\.tower-ready-room-roster\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("Ready Room keeps the authoritative bound Story encounter and artwork visible", () => {
    assert.match(panel, /import \{ resolveTowerStoryArt \} from "\.\.\/lib\/tower-art-manifest"/);
    assert.match(panel, /party\?\.binding\.mode === "story" && storyFloorMeta\?\.id === party\.binding\.floor/);
    assert.match(panel, /--tower-ready-room-mission-art/);
    assert.match(panel, /aria-labelledby="tower-ready-room-mission-title"/);
    assert.match(panel, /readyRoomObjectiveLabel\(boundStoryFloor\.objective\)/);
    assert.match(lobby, /const readyRoomBinding = activeReadyRoom\?\.binding;/);
    assert.match(lobby, /const readyRoomStoryFloor = readyRoomBinding\?\.mode === "story"/);
    assert.match(lobby, /storyFloorMeta=\{readyRoomStoryFloor\}/);
    assert.match(css, /\.tower-ready-room-binding\.has-art\s*\{[\s\S]{0,420}?var\(--tower-ready-room-mission-art\)/);
    assert.match(css, /@media \(prefers-reduced-data: reduce\)[\s\S]{0,180}?\.tower-ready-room-binding\.has-art[\s\S]{0,70}?background-image:\s*none/);
});

test("Ready Room keyboard flows submit invites, preserve transition focus, and confirm leaving", () => {
    assert.match(panel, /className="tower-ready-room-recruit" onSubmit=\{event =>/);
    assert.match(panel, /if \(event\.key !== "Enter" \|\| event\.nativeEvent\.isComposing\) return;/);
    assert.match(panel, /invitePlayerByName\(party\)/);
    assert.match(panel, /activeRoomHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
    assert.match(panel, /openRoomHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
    assert.match(panel, /gameConfirm\(leaveRoomPrompt\(party, isHost\)\)/);
    assert.match(panel, /Host control will pass to another live member/);
    assert.match(panel, /Leave and close this Ready Room/);
    assert.match(panel, /aria-describedby="tower-ready-room-code-help"/);
});

test("Ready Room exposes a semantic ready gate and resilient sync recovery", () => {
    assert.match(panel, /<progress value=\{readyCount\} max=\{party\.members\.length\}/);
    assert.match(panel, /aria-label=\{`Squad readiness: \$\{readyCount\} of \$\{party\.members\.length\} members ready`\}/);
    assert.match(panel, /Restoring squad connection/);
    assert.match(panel, /onClick=\{\(\) => roomRefreshRef\.current\(\)\}/);
    assert.match(css, /\.tower-ready-room-other-invitations > summary\s*\{[\s\S]{0,180}?min-height:\s*44px/);
    assert.match(css, /\.tower-ready-room-readiness progress\s*\{[\s\S]{0,180}?accent-color:\s*#2dd4bf/);
});

test("Story briefing copy treats round budgets as objective-aware pace and combatants as starting count", () => {
    assert.match(lobby, /if \(objective === "protect-npc"\) return `Hold \$\{roundBudget\} rounds`/);
    assert.match(lobby, /if \(objective === "survive"\) return `Survive \$\{roundBudget\} rounds`/);
    assert.match(lobby, /return `Par \/ score pace · \$\{roundBudget\} rounds`/);
    assert.match(lobby, /\$\{selFloor\.phaseReinforcementCount\} phase reinforcements/);
    assert.match(lobby, /starting combatant/);
    assert.doesNotMatch(lobby, /round budget/);
});
