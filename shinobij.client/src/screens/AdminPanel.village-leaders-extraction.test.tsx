import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminVillageLeadersPanel } from "./AdminVillageLeadersPanel";

const screensDirectory = join(process.cwd(), "shinobij.client", "src", "screens");
const parentSource = readFileSync(join(screensDirectory, "AdminPanel.tsx"), "utf8");
const leafSource = readFileSync(join(screensDirectory, "AdminVillageLeadersPanel.tsx"), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0, `missing source marker: ${start}`);
    assert.ok(endIndex > startIndex, `missing source marker after ${start}: ${end}`);
    return source.slice(startIndex, endIndex);
}

function assertOrdered(source: string, markers: string[]) {
    let previousIndex = -1;
    for (const marker of markers) {
        const index = source.indexOf(marker, previousIndex + 1);
        assert.ok(index > previousIndex, `expected ${marker} after the previous render marker`);
        previousIndex = index;
    }
}

describe("AdminPanel Village Leaders extraction", () => {
    it("keeps the active-tab gate in AdminPanel and mounts the render leaf with explicit callbacks", () => {
        assert.match(parentSource, /import \{ AdminVillageLeadersPanel \} from "\.\/AdminVillageLeadersPanel";/);
        const mount = sourceBetween(
            parentSource,
            '{activeAdminPanel === "villageLeaders" && (',
            '{activeAdminPanel === "jutsuBloodlines" && (',
        );
        assert.match(mount, /<AdminVillageLeadersPanel/);
        for (const prop of [
            "leadershipImages={leadershipImages}",
            "leaderSaveStatus={leaderSaveStatus}",
            "elderRoleLabels={VILLAGE_ELDER_ROLE_LABELS}",
            "onSaveAll={saveAllLeaderImages}",
            "onGenerateAllMissing={generateAllMissingLeaderImages}",
            "onImageFile={readLeadershipImageFile}",
            "onUpdateImage={updateLeadershipImage}",
        ]) assert.ok(mount.includes(prop), `missing Village Leaders prop: ${prop}`);
        assert.doesNotMatch(mount, /village-leader-section|AiImagePrompt|Save All Leader Images/);
    });

    it("keeps state and every effectful operation in the parent", () => {
        assert.match(parentSource, /const \[leadershipImages, setLeadershipImages\] = useState<VillageLeadershipImages>/);
        assert.match(parentSource, /const \[leaderSaveStatus, setLeaderSaveStatus\] = useState\(""\)/);
        assert.match(parentSource, /function updateLeadershipImage/);
        const handlers = sourceBetween(parentSource, "function updateLeadershipImage", "const sortedBloodlines");
        for (const marker of [
            "publishSharedImage",
            "saveVillageLeadershipImages",
            "readImageFile",
            'fetch("/api/generate-image"',
            "gameConfirm",
            "Promise.all(imagePromises)",
            "onSaveRef.current()",
            "setLeaderSaveStatus",
        ]) assert.ok(handlers.includes(marker), `effect escaped parent handler boundary: ${marker}`);
    });

    it("keeps the leaf hook-, network-, storage-, and publish-free", () => {
        assert.doesNotMatch(leafSource, /\b(?:useState|useEffect|useLayoutEffect|useRef|fetch|localStorage|sessionStorage|publishSharedImage|saveVillageLeadershipImages|readImageFile|onSaveRef)\b/);
        assert.doesNotMatch(leafSource, /\b(?:alert|gameConfirm|setTimeout|Promise\.all)\b/);
    });

    it("preserves the Village Leaders DOM order, copy, file inputs, and AI prompts", () => {
        assertOrdered(leafSource, [
            'className="admin-subpanel"',
            'className="admin-panel-heading"',
            "<h3>Village Leaders</h3>",
            "Save All Leader Images",
            "Object.entries(villageLeadership)",
            'className="summary-box village-leader-section" key={village}',
            'className="village-leader-section-header"',
            'className="leader-admin-grid"',
            'className="leader-admin-card"',
            "<h4>Kage</h4>",
            "leadership.elders.map",
        ]);
        assert.match(leafSource, /Add portraits for the Kage, War Elder, Trade Elder, and Training Elder\. These appear in each village's Town Hall\./);
        assert.equal(leafSource.match(/<input type="file" accept="image\/\*"/g)?.length, 2);
        assert.match(leafSource, /<AiImagePrompt label="Kage Image" suggestedPrompt=\{`\$\{leadership\.kage\}, shinobi village Kage leader portrait`\}/);
        assert.match(leafSource, /<AiImagePrompt label="Elder Image" suggestedPrompt=\{`\$\{elder\}, \$\{elderRoleLabels\[index\] \?\? "elder"\}, shinobi NPC portrait`\}/);
        assert.match(leafSource, /className="danger-button"/);
        assert.match(leafSource, /key=\{elder\}/);
    });

    it("renders the complete deterministic leadership surface", () => {
        const previousReact = Reflect.get(globalThis, "React");
        Reflect.set(globalThis, "React", React);
        let markup: string;
        try {
            markup = renderToStaticMarkup(React.createElement(
                AdminVillageLeadersPanel,
                {
                    leadershipImages: {
                        "Stormveil Village": { kage: "/test/raiko.webp", elders: ["", "", ""] },
                    },
                    leaderSaveStatus: "Saved!",
                    elderRoleLabels: ["War Elder", "Trade Elder", "Training Elder"],
                    onSaveAll: async () => {},
                    onGenerateAllMissing: async () => {},
                    onImageFile: () => {},
                    onUpdateImage: () => {},
                },
            ));
        } finally {
            if (previousReact === undefined) Reflect.deleteProperty(globalThis, "React");
            else Reflect.set(globalThis, "React", previousReact);
        }

        assert.equal(markup.match(/class="admin-subpanel"/g)?.length, 1);
        assert.equal(markup.match(/<h3>Village Leaders<\/h3>/g)?.length, 1);
        assert.equal(markup.match(/class="leader-admin-card"/g)?.length, 16);
        assert.equal(markup.match(/type="file" accept="image\/\*"/g)?.length, 16);
        assert.equal(markup.match(/class="leader-image-placeholder">No Image<\/div>/g)?.length, 15);
        assert.equal(markup.match(/✨ Generate/g)?.length, 4);
        assert.match(markup, /alt="Kage Raiko Veyr"/);
        assert.match(markup, /<strong>Kage Raiko Veyr<\/strong>/);
        assert.match(markup, /<strong>Elder Vanta<\/strong>/);
        assert.match(markup, /✨ Generate 3 Missing Portraits/);
        assert.match(markup, /<span class="hint" style="color:#a5d6a7">Saved!<\/span>/);

        const saveIndex = markup.indexOf("Save All Leader Images");
        const statusIndex = markup.indexOf(">Saved!</span>");
        const firstVillageIndex = markup.indexOf('class="summary-box village-leader-section"');
        assert.ok(saveIndex >= 0 && saveIndex < statusIndex && statusIndex < firstVillageIndex);
    });
});
