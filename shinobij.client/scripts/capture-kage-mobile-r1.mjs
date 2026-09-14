import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, "..");
const target = process.argv[2] ?? "http://127.0.0.1:5187/petvfx.html?rite=1&petQuality=low";
const outputDir = path.resolve(process.argv[3] ?? path.join(clientDir, "artifacts", "kage-mobile-report-r1"));
const evidenceRound = path.basename(outputDir).replace(/^kage-mobile-report-/u, "") || "r1";
const reportTargetUrl = new URL(target);
reportTargetUrl.searchParams.set("rite", "1");
reportTargetUrl.searchParams.set("seed", "23");
reportTargetUrl.searchParams.set("petQuality", "low");
reportTargetUrl.searchParams.set("ritespeed", "12");
reportTargetUrl.searchParams.set("riteqa", "1");
const reportTarget = reportTargetUrl.toString();

// 480 × 1040 at 3× produces the requested 1440 × 3120 QHD capture exactly.
// The layout gate below also exercises the project's established 412 × 915
// browser profile, covering Samsung display-scale differences without treating
// physical pixels as CSS pixels.
const captureProfiles = [
    { id: "portrait", viewport: { width: 480, height: 1040 }, deviceScaleFactor: 3, physical: { width: 1440, height: 3120 } },
    { id: "landscape", viewport: { width: 1040, height: 480 }, deviceScaleFactor: 3, physical: { width: 3120, height: 1440 } },
];
const compatibilityProfiles = [
    { id: "compact-portrait", viewport: { width: 412, height: 915 } },
    { id: "compact-landscape", viewport: { width: 915, height: 412 } },
];

await mkdir(outputDir, { recursive: true });

const errors = [];
const report = {
    generatedAt: new Date().toISOString(),
    target,
    reportTarget,
    benchmarkReferences: [
        {
            product: "Teamfight Tactics Mobile",
            url: "https://teamfighttactics.leagueoflegends.com/en-us/news/riot-games/teamfight-tactics-mobile-update/",
            observedBar: "Finger-friendly drag surfaces and collapsible chrome preserve a complete battlefield view.",
        },
        {
            product: "Super Auto Pets",
            url: "https://apps.apple.com/us/app/super-auto-pets/id1597449908",
            observedBar: "A compact resource rail, a dominant formation lane, and one unmistakable advance action teach the loop in place.",
        },
    ],
    gates: [],
    captures: [],
    compatibility: [],
    errors,
};

const gate = (condition, name, detail) => {
    const entry = { name, passed: Boolean(condition), detail };
    report.gates.push(entry);
    if (!condition) errors.push(`${name}: ${detail}`);
};

const round = (value) => Number(value.toFixed(2));
const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const rectDelta = (a, b) => Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
);

async function touchTap(page, locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error("touch target has no bounding box");
    const point = center(box);
    await page.touchscreen.tap(point.x, point.y);
}

async function waitForReopenedReportSettled(page, label) {
    const reportLayer = page.locator(".wfr-reform-evidence");
    await page.waitForFunction(() => {
        const panel = document.querySelector('.wfr-reform[aria-label="Tactical report and re-form"]');
        const layer = panel?.querySelector(".wfr-reform-evidence");
        if (!(layer instanceof HTMLElement) || panel?.getAttribute("data-mobile-report-state") !== "open") return false;
        const style = getComputedStyle(layer);
        let transformAtRest = style.transform === "none";
        if (!transformAtRest) {
            try {
                const matrix = new DOMMatrixReadOnly(style.transform);
                transformAtRest = Math.abs(matrix.m11 - 1) < 0.001
                    && Math.abs(matrix.m12) < 0.001
                    && Math.abs(matrix.m21) < 0.001
                    && Math.abs(matrix.m22 - 1) < 0.001
                    && Math.abs(matrix.m41) < 0.001
                    && Math.abs(matrix.m42) < 0.001;
            } catch {
                transformAtRest = false;
            }
        }
        const transitionActive = layer.getAnimations().some((animation) => animation.pending
            || (animation.playState !== "idle" && animation.playState !== "finished"));
        return Number(style.opacity) === 1
            && style.visibility === "visible"
            && transformAtRest
            && !transitionActive;
    }, undefined, { polling: "raf", timeout: 5_000 });
    const visualState = await reportLayer.evaluate((layer) => {
        const style = getComputedStyle(layer);
        const matrix = style.transform === "none" ? null : new DOMMatrixReadOnly(style.transform);
        const transformAtRest = matrix === null || (
            Math.abs(matrix.m11 - 1) < 0.001
            && Math.abs(matrix.m12) < 0.001
            && Math.abs(matrix.m21) < 0.001
            && Math.abs(matrix.m22 - 1) < 0.001
            && Math.abs(matrix.m41) < 0.001
            && Math.abs(matrix.m42) < 0.001
        );
        const activeTransitions = layer.getAnimations()
            .filter((animation) => animation.pending || (animation.playState !== "idle" && animation.playState !== "finished"))
            .map((animation) => animation.constructor.name);
        return {
            opacity: Number(style.opacity),
            visibility: style.visibility,
            transform: style.transform,
            transformAtRest,
            activeTransitions,
        };
    });
    gate(visualState.opacity === 1
        && visualState.visibility === "visible"
        && visualState.transformAtRest
        && visualState.activeTransitions.length === 0,
    `${label} waits for a fully opaque, settled report layer`, JSON.stringify(visualState));
    return visualState;
}

async function touchDrag(context, page, source, targetLocator, screenshotPath) {
    const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), targetLocator.boundingBox()]);
    if (!sourceBox || !targetBox) throw new Error("drag endpoint has no bounding box");
    const from = center(sourceBox);
    const to = center(targetBox);
    const client = await context.newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: from.x, y: from.y, id: 1, radiusX: 4, radiusY: 4, force: 0.65 }],
    });
    for (let step = 1; step <= 7; step += 1) {
        const x = from.x + (to.x - from.x) * (step / 7);
        const y = from.y + (to.y - from.y) * (step / 7);
        await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 0.65 }],
        });
        await page.waitForTimeout(18);
    }
    await page.screenshot({ path: screenshotPath, type: "png" });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
}

async function readDeployment(page) {
    return page.evaluate(() => {
        const rect = (node) => {
            if (!(node instanceof HTMLElement)) return null;
            const box = node.getBoundingClientRect();
            return {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                right: box.right,
                bottom: box.bottom,
            };
        };
        const overlap = (a, b) => {
            if (!a || !b) return 0;
            return Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x))
                * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
        };
        const actionable = [...document.querySelectorAll(
            ".wfr-pet-picker button, .wfr-placement-grid button, .wfr-deploy-actions button, .wfr-inspect-ack, .wfr-landscape-drawer-trigger",
        )].filter((node) => node instanceof HTMLElement && node.offsetParent !== null).map((node) => {
            const box = rect(node);
            const hit = box ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null;
            return {
                label: node.getAttribute("aria-label") ?? node.textContent?.trim().replace(/\s+/gu, " ").slice(0, 80) ?? "button",
                box,
                centerReachable: Boolean(hit && (hit === node || node.contains(hit))),
            };
        });
        const panel = document.querySelector(".wfr-deploy");
        const board = document.querySelector(".wfr-placement-board");
        const actions = document.querySelector(".wfr-deploy-actions");
        const panelBox = rect(panel);
        const boardBox = rect(board);
        const actionBox = rect(actions);
        const cssPx = (selector) => {
            const node = document.querySelector(selector);
            return node instanceof HTMLElement ? Number.parseFloat(getComputedStyle(node).fontSize) : Number.NaN;
        };
        const portraitArt = (selector) => {
            const portraits = [...document.querySelectorAll(selector)];
            const decoded = portraits.filter((portrait) => {
                const image = portrait.querySelector("img");
                return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
            });
            return {
                count: portraits.length,
                decoded: decoded.length,
                fallbacks: portraits.filter((portrait) => portrait.getAttribute("data-wfr-portrait-kind") === "fallback").length,
                sources: decoded.map((portrait) => portrait.querySelector("img")?.getAttribute("src") ?? ""),
            };
        };
        return {
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            panelScrollOverflow: panel instanceof HTMLElement ? panel.scrollHeight - panel.clientHeight : Number.NaN,
            panelBox,
            boardBox,
            actionBox,
            boardActionOverlap: overlap(boardBox, actionBox),
            boardWidthRatio: boardBox ? boardBox.width / innerWidth : Number.NaN,
            landscapeInspectState: panel?.getAttribute("data-landscape-inspect-state") ?? "missing",
            landscapeOpenDrawer: panel?.getAttribute("data-landscape-open-drawer") ?? "missing",
            landscapeAck: [...document.querySelectorAll(".wfr-inspect-ack")]
                .filter((node) => node instanceof HTMLElement && node.offsetParent !== null)
                .map((node) => {
                    const box = rect(node);
                    const hit = box ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null;
                    return {
                        label: node.getAttribute("aria-label"),
                        box,
                        centerReachable: Boolean(hit && (hit === node || node.contains(hit))),
                    };
                }),
            landscapeDrawerControls: [...document.querySelectorAll(".wfr-landscape-drawer-trigger")]
                .filter((node) => node instanceof HTMLElement && node.offsetParent !== null)
                .map((node) => {
                    const box = rect(node);
                    const hit = box ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null;
                    return {
                        label: node.getAttribute("aria-label"),
                        expanded: node.getAttribute("aria-expanded"),
                        box,
                        centerReachable: Boolean(hit && (hit === node || node.contains(hit))),
                    };
                }),
            guideHidden: document.querySelector(".wfr-guide-drawer")?.getAttribute("aria-hidden") ?? "unset",
            scoutHidden: document.querySelector(".wfr-scout")?.getAttribute("aria-hidden") ?? "unset",
            actionable,
            onboarding: [...document.querySelectorAll(".wfr-onboarding strong")].map((node) => node.textContent?.trim()),
            causality: document.querySelector(".wfr-deploy-copy")?.textContent?.trim().replace(/\s+/gu, " ") ?? "",
            legalDropCount: document.querySelectorAll('[data-wfr-legal-drop="true"]').length,
            occupiedCount: document.querySelectorAll('[data-wfr-legal-drop="false"]').length,
            portraitArt: {
                picker: portraitArt(".wfr-pet-picker .wfr-portrait"),
                scout: portraitArt(".wfr-scout .wfr-portrait"),
                occupiedCells: portraitArt('.wfr-placement-grid [data-wfr-legal-drop="false"] .wfr-portrait'),
            },
            fontPx: {
                causality: cssPx(".wfr-deploy-copy"),
                onboarding: cssPx(".wfr-onboarding strong"),
                petName: cssPx(".wfr-pet-picker strong"),
                action: cssPx(".wfr-btn-primary"),
            },
        };
    });
}

function gateDeployment(state, label) {
    const { width, height } = state.viewport;
    gate(state.overflowX <= 1, `${label} has no horizontal overflow`, `overflow ${round(state.overflowX)}px`);
    gate(state.panelScrollOverflow <= 1, `${label} fits without an internal deploy scroll`, `overflow ${round(state.panelScrollOverflow)}px`);
    gate(Boolean(state.panelBox && state.panelBox.x >= -1 && state.panelBox.y >= -1
        && state.panelBox.right <= width + 1 && state.panelBox.bottom <= height + 1),
    `${label} panel stays inside the safe viewport`, JSON.stringify(state.panelBox));
    gate(Boolean(state.boardBox && state.boardBox.x >= -1 && state.boardBox.y >= -1
        && state.boardBox.right <= width + 1 && state.boardBox.bottom <= height + 1),
    `${label} board is fully visible`, JSON.stringify(state.boardBox));
    gate(state.boardActionOverlap === 0, `${label} actions do not occlude the board`, `overlap ${state.boardActionOverlap}px²`);
    gate(state.actionable.every((item) => item.box && item.box.width >= 44 && item.box.height >= 44),
        `${label} controls meet the 44 CSS px touch floor`, JSON.stringify(state.actionable.filter((item) => !item.box || item.box.width < 44 || item.box.height < 44)));
    gate(state.actionable.every((item) => item.centerReachable), `${label} has no interaction dead zones`, JSON.stringify(state.actionable.filter((item) => !item.centerReachable)));
    gate(state.onboarding.join("|") === "Inspect matchup|Drag or tap any pet|Lock formation",
        `${label} exposes the causal three-step onboarding`, state.onboarding.join(" | "));
    gate(/Starting cells decide first contact/u.test(state.causality), `${label} explains placement causality`, state.causality);
    const art = state.portraitArt;
    const expectedPetArt = art.picker.count === 4 && art.picker.decoded === 4 && art.picker.fallbacks === 0
        && art.scout.count === 2 && art.scout.decoded === 2 && art.scout.fallbacks === 0
        && art.occupiedCells.count === 4 && art.occupiedCells.decoded === 4 && art.occupiedCells.fallbacks === 0;
    gate(state.legalDropCount === 6 && state.occupiedCount === 4 && expectedPetArt,
        `${label} exposes every legal cell with decoded pet art`, JSON.stringify({ open: state.legalDropCount, occupied: state.occupiedCount, art }));
    gate(state.fontPx.causality >= 11 && state.fontPx.onboarding >= 9.5 && state.fontPx.petName >= 9.5 && state.fontPx.action >= 10,
        `${label} keeps decision copy readable`, JSON.stringify(state.fontPx));
}

function gateLandscapeInspect(state, label) {
    const ack = state.landscapeAck[0];
    gate(state.landscapeInspectState === "pending" && state.landscapeDrawerControls.length === 0,
        `${label} starts with the matchup inspection expanded`, JSON.stringify({ state: state.landscapeInspectState, drawers: state.landscapeDrawerControls.length }));
    gate(state.landscapeAck.length === 1 && ack?.box && ack.box.width >= 44 && ack.box.height >= 44 && ack.centerReachable,
        `${label} exposes a reachable 44px matchup acknowledgement`, JSON.stringify(state.landscapeAck));
}

function gateLandscapeCompact(state, label) {
    gate(state.landscapeInspectState === "acknowledged" && state.landscapeOpenDrawer === "none",
        `${label} collapses secondary chrome after inspection`, JSON.stringify({ state: state.landscapeInspectState, drawer: state.landscapeOpenDrawer }));
    gate(state.boardWidthRatio >= 0.6,
        `${label} gives at least 60% of viewport width to the formation board`, `${(state.boardWidthRatio * 100).toFixed(1)}%`);
    gate(state.landscapeDrawerControls.length === 2
        && state.landscapeDrawerControls.every((item) => item.box?.width >= 44 && item.box?.height >= 44 && item.centerReachable),
    `${label} exposes two reachable 44px edge drawer controls`, JSON.stringify(state.landscapeDrawerControls));
    gate(state.guideHidden === "true" && state.scoutHidden === "true",
        `${label} removes collapsed copy and matchup detail from the reading order`, JSON.stringify({ guide: state.guideHidden, scout: state.scoutHidden }));
}

function gatePortraitLandscapeChromeHidden(state, label) {
    gate(state.landscapeAck.length === 0 && state.landscapeDrawerControls.length === 0,
        `${label} preserves the portrait deploy surface without landscape controls`, JSON.stringify({ acknowledgement: state.landscapeAck, drawers: state.landscapeDrawerControls }));
}

async function exerciseLandscapeDrawers(page, outputDir, profileId, compactBoard) {
    const results = [];
    const drawers = [
        { id: "guide", label: "deployment guide", selector: ".wfr-guide-drawer" },
        { id: "scout", label: "matchup scout", selector: ".wfr-scout" },
    ];
    for (const drawer of drawers) {
        await touchTap(page, page.getByRole("button", { name: `Open ${drawer.label}` }));
        await page.waitForFunction((selector) => {
            const panel = document.querySelector(selector);
            if (!(panel instanceof HTMLElement)) return false;
            const style = getComputedStyle(panel);
            return style.visibility === "visible" && Number(style.opacity) >= 0.99;
        }, drawer.selector);
        const openState = await readDeployment(page);
        const boardDelta = compactBoard && openState.boardBox ? rectDelta(compactBoard, openState.boardBox) : Number.POSITIVE_INFINITY;
        const expectedHidden = drawer.id === "guide"
            ? openState.guideHidden === "false" && openState.scoutHidden === "true"
            : openState.guideHidden === "true" && openState.scoutHidden === "false";
        results.push({ drawer: drawer.id, boardDelta, expectedHidden, state: openState.landscapeOpenDrawer });
        await page.screenshot({ path: path.join(outputDir, `${profileId}-01${drawer.id === "guide" ? "a" : "b"}-${drawer.id}-drawer.png`), type: "png" });
        await touchTap(page, page.getByRole("button", { name: `Close ${drawer.label}` }));
        await page.waitForFunction((selector) => {
            const deploy = document.querySelector(".wfr-deploy");
            const panel = document.querySelector(selector);
            return deploy?.getAttribute("data-landscape-open-drawer") === "none"
                && panel instanceof HTMLElement
                && getComputedStyle(panel).visibility === "hidden";
        }, drawer.selector);
    }
    gate(results.every((entry) => entry.state === entry.drawer && entry.expectedHidden && entry.boardDelta <= 1),
        `${profileId} drawers preserve board geometry and expose one panel at a time`, JSON.stringify(results));
    return results;
}

async function exerciseAllTapPlacements(page, label, scope = page) {
    const picker = scope.getByLabel("Choose a pet to place").locator("button");
    const matrix = [];
    for (let slot = 0; slot < 4; slot += 1) {
        const source = picker.nth(slot);
        const petName = (await source.locator("strong").textContent())?.trim() ?? `slot-${slot}`;
        const legalNodeIds = await scope.locator('[data-wfr-legal-drop="true"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-wfr-node-id")));
        for (const nodeId of legalNodeIds) {
            if (nodeId === null) continue;
            await touchTap(page, source);
            const targetCell = scope.locator(`[data-wfr-node-id="${nodeId}"]`);
            await touchTap(page, targetCell);
            const moved = await targetCell.getAttribute("data-wfr-legal-drop") === "false"
                && new RegExp(`occupied by ${petName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "iu").test(await targetCell.getAttribute("aria-label") ?? "");
            matrix.push({ slot, petName, nodeId: Number(nodeId), moved });
            if (!moved) break;
        }
    }
    gate(matrix.length === 24 && matrix.every((entry) => entry.moved),
        `${label} lets every pet tap-move through every legal open cell`, `${matrix.filter((entry) => entry.moved).length}/24 moves`);
    return matrix;
}

async function readReform(page) {
    return page.getByRole("dialog", { name: "Tactical report and re-form" }).evaluate(async (panel) => {
        const normalize = (value) => value?.trim().replace(/\s+/gu, " ") ?? "";
        const rect = (node) => {
            if (!(node instanceof HTMLElement)) return null;
            const box = node.getBoundingClientRect();
            return {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                right: box.right,
                bottom: box.bottom,
            };
        };
        const rendered = (node) => {
            if (!(node instanceof HTMLElement)) return false;
            const style = getComputedStyle(node);
            const box = node.getBoundingClientRect();
            return style.display !== "none"
                && style.visibility === "visible"
                && Number.parseFloat(style.opacity) > 0.01
                && box.width > 0
                && box.height > 0
                && box.right > 0
                && box.bottom > 0
                && box.left < innerWidth
                && box.top < innerHeight;
        };
        const reportState = panel.getAttribute("data-mobile-report-state") ?? "missing";
        const evidence = panel.querySelector(".wfr-reform-evidence");
        const reportLayerOpen = reportState === "required" || reportState === "open";
        const reportTextSelector = [
            ".wfr-reform-evidence > .wfr-eyebrow",
            ".wfr-reform-evidence > h3",
            ".wfr-report-facts small",
            ".wfr-report-facts strong",
            ".wfr-fought-formation > .wfr-next-label",
            ".wfr-fought-formation li strong",
            ".wfr-fought-formation li small",
            ".wfr-reform-copy",
            ".wfr-no-prediction",
            ".wfr-report-ack > span",
            ".wfr-report-ack > strong",
            ".wfr-reform-drawer-trigger > span",
        ].join(", ");
        const decisionTextSelector = [
            ".wfr-reform-drawer-trigger > span",
            ".wfr-pet-picker strong",
            ".wfr-pet-picker small",
            ".wfr-depth-labels span",
            ".wfr-route-labels span",
            ".wfr-formation-diff > span",
            ".wfr-formation-diff strong",
            ".wfr-deploy-actions button",
        ].join(", ");
        const textSamples = [...panel.querySelectorAll(reportLayerOpen ? reportTextSelector : decisionTextSelector)]
            .filter(rendered)
            .map((node) => ({
                selector: node.className || node.tagName.toLowerCase(),
                text: normalize(node.textContent),
                fontPx: Number.parseFloat(getComputedStyle(node).fontSize),
                box: rect(node),
            }))
            .filter((entry) => entry.text.length > 0);
        if (!reportLayerOpen) {
            const board = panel.querySelector(".wfr-placement-board");
            if (board instanceof HTMLElement && rendered(board)) {
                const pseudo = getComputedStyle(board, "::after");
                const content = pseudo.content.replace(/^["']|["']$/gu, "");
                if (content && content !== "none" && content !== "normal") {
                    textSamples.push({
                        selector: ".wfr-placement-board::after",
                        text: content,
                        fontPx: Number.parseFloat(pseudo.fontSize),
                        box: rect(board),
                    });
                }
            }
        }
        const actionables = [...panel.querySelectorAll("button")]
            .filter((node) => rendered(node))
            .filter((node) => reportLayerOpen
                ? Boolean(evidence?.contains(node) || node.classList.contains("wfr-reform-drawer-trigger"))
                : !evidence?.contains(node))
            .map((node) => {
                const box = rect(node);
                const hit = box ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null;
                return {
                    label: node.getAttribute("aria-label") ?? normalize(node.textContent) ?? "button",
                    disabled: node.hasAttribute("disabled"),
                    box,
                    centerReachable: Boolean(hit && (hit === node || node.contains(hit))),
                };
            });
        const facts = [...panel.querySelectorAll(".wfr-report-facts > span")].map((node) => ({
            label: normalize(node.querySelector("small")?.textContent),
            value: normalize(node.querySelector("strong")?.textContent),
        }));
        const opponentImages = [...panel.querySelectorAll(".wfr-fought-formation li .wfr-portrait img")];
        await Promise.all(opponentImages.map((image) => image.decode().catch(() => undefined)));
        const reportBox = rect(evidence);
        const opponentFormation = [...panel.querySelectorAll(".wfr-fought-formation li")].map((node) => {
            const portrait = node.querySelector(".wfr-portrait");
            const image = portrait?.querySelector("img");
            const name = node.querySelector("strong");
            const cell = node.querySelector("small");
            const rowBox = rect(node);
            const textFit = (textNode) => {
                const style = textNode instanceof HTMLElement ? getComputedStyle(textNode) : null;
                return {
                    fontPx: style ? Number.parseFloat(style.fontSize) : Number.NaN,
                    clientWidth: textNode instanceof HTMLElement ? textNode.clientWidth : 0,
                    scrollWidth: textNode instanceof HTMLElement ? textNode.scrollWidth : Number.POSITIVE_INFINITY,
                    textOverflow: style?.textOverflow ?? "missing",
                };
            };
            return {
                pet: normalize(name?.textContent),
                cell: normalize(cell?.textContent),
                petId: portrait?.getAttribute("data-wfr-pet-id") ?? "",
                portraitKind: portrait?.getAttribute("data-wfr-portrait-kind") ?? "missing",
                image: image instanceof HTMLImageElement ? {
                    source: image.currentSrc || image.src,
                    complete: image.complete,
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                } : null,
                nameFit: textFit(name),
                cellFit: textFit(cell),
                box: rowBox,
                fullyVisible: Boolean(rowBox && reportBox
                    && rowBox.x >= Math.max(0, reportBox.x) - 0.5
                    && rowBox.y >= Math.max(0, reportBox.y) - 0.5
                    && rowBox.right <= Math.min(innerWidth, reportBox.right) + 0.5
                    && rowBox.bottom <= Math.min(innerHeight, reportBox.bottom) + 0.5),
            };
        });
        const panelBox = rect(panel);
        const boardBox = rect(panel.querySelector(".wfr-placement-board"));
        const diff = panel.querySelector(".wfr-formation-diff");
        const actionRoot = panel.querySelector(".wfr-deploy-actions");
        const diffBox = rect(diff);
        const clips = (value) => /^(auto|hidden|scroll|clip)$/u.test(value);
        const visibleClip = diffBox ? {
            left: Math.max(0, diffBox.x),
            top: Math.max(0, diffBox.y),
            right: Math.min(innerWidth, diffBox.right),
            bottom: Math.min(innerHeight, diffBox.bottom),
        } : null;
        if (diff instanceof HTMLElement && visibleClip) {
            for (let ancestor = diff.parentElement; ancestor; ancestor = ancestor.parentElement) {
                const style = getComputedStyle(ancestor);
                const box = ancestor.getBoundingClientRect();
                if (clips(style.overflowX)) {
                    visibleClip.left = Math.max(visibleClip.left, box.left);
                    visibleClip.right = Math.min(visibleClip.right, box.right);
                }
                if (clips(style.overflowY)) {
                    visibleClip.top = Math.max(visibleClip.top, box.top);
                    visibleClip.bottom = Math.min(visibleClip.bottom, box.bottom);
                }
            }
        }
        const actionSurfaces = [actionRoot, ...(actionRoot ? [...actionRoot.querySelectorAll("button")] : [])]
            .filter((node) => node instanceof HTMLElement)
            .map((node) => ({
                label: node === actionRoot ? ".wfr-deploy-actions" : normalize(node.textContent),
                box: rect(node),
            }));
        const intersects = (a, b) => Boolean(a && b
            && Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0
            && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0);
        const diffRows = diff instanceof HTMLElement ? [...diff.querySelectorAll(":scope > strong")].map((node) => {
            const box = rect(node);
            return {
                text: normalize(node.textContent),
                box,
                fullyInsideVisibleClip: Boolean(box && visibleClip
                    && box.x >= visibleClip.left - 0.5
                    && box.y >= visibleClip.top - 0.5
                    && box.right <= visibleClip.right + 0.5
                    && box.bottom <= visibleClip.bottom + 0.5),
                intersections: actionSurfaces.filter((surface) => intersects(box, surface.box)).map((surface) => surface.label),
            };
        }) : [];
        return {
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            reportState,
            dialogLabel: panel.getAttribute("aria-label"),
            reportLabel: evidence?.getAttribute("aria-label") ?? "",
            reportAriaHidden: evidence?.getAttribute("aria-hidden") ?? "unset",
            clashMarker: normalize(document.querySelector(".wfr-duel-no")?.textContent),
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            panelOverflowX: panel.scrollWidth - panel.clientWidth,
            reportOverflowX: evidence instanceof HTMLElement ? evidence.scrollWidth - evidence.clientWidth : Number.NaN,
            panelBox,
            reportBox,
            boardBox,
            facts,
            opponentFormation,
            textSamples,
            actionables,
            deployment: [...panel.querySelectorAll(".wfr-pet-picker > button small")].map((node) => normalize(node.textContent)),
            pickerPets: [...panel.querySelectorAll(".wfr-pet-picker > button strong")].map((node) => normalize(node.textContent)),
            openCellCount: panel.querySelectorAll('[data-wfr-legal-drop="true"]').length,
            occupiedCount: panel.querySelectorAll('[data-wfr-legal-drop="false"]').length,
            diffText: normalize(diff?.textContent),
            diffVisible: rendered(diff),
            formationDiff: { box: diffBox, visibleClip, rows: diffRows, actionSurfaces },
        };
    });
}

function gateFormationDiff(state, baseline, label, expectedCount) {
    const expectedRows = baseline.deployment
        .map((cell, index) => cell !== state.deployment[index]
            ? `${baseline.pickerPets[index]}: ${cell} → ${state.deployment[index]}`
            : null)
        .filter(Boolean);
    const rowTexts = state.formationDiff.rows.map((row) => row.text);
    gate(expectedRows.length === expectedCount
        && rowTexts.length === expectedRows.length
        && expectedRows.every((row, index) => rowTexts[index] === row),
    `${label} renders every expected formation change row`, JSON.stringify({ expectedRows, rowTexts }));
    gate(state.formationDiff.rows.every((row) => row.fullyInsideVisibleClip),
        `${label} keeps every change row fully inside the formation diff visible clip`, JSON.stringify(state.formationDiff));
    gate(state.formationDiff.rows.every((row) => row.intersections.length === 0),
        `${label} keeps every change row clear of the action region and buttons`, JSON.stringify(state.formationDiff));
}

function insideViewport(box, viewport) {
    return Boolean(box
        && box.x >= -1
        && box.y >= -1
        && box.right <= viewport.width + 1
        && box.bottom <= viewport.height + 1);
}

function gateReformSurface(state, label, expectedState) {
    const expectedFactLabels = ["Winner", "First KO", "Highest damage threat"];
    gate(state.dialogLabel === "Tactical report and re-form" && state.reportState === expectedState,
        `${label} exposes the requested mobile report state`, JSON.stringify({ dialog: state.dialogLabel, state: state.reportState }));
    if (expectedState !== "available") {
        gate(state.reportLabel === "Clash 1 tactical report"
            && state.facts.length === 3
            && state.facts.map((entry) => entry.label).join("|") === expectedFactLabels.join("|")
            && state.facts.every((entry) => entry.value.length > 0),
        `${label} reads all three authoritative Clash 1 facts`, JSON.stringify(state.facts));
        gate(state.opponentFormation.length === 4
            && state.opponentFormation.every((entry) => entry.pet.length > 0 && entry.cell.length > 0),
        `${label} reads all four opponent formation rows`, JSON.stringify(state.opponentFormation));
        if (state.viewport.width <= state.viewport.height) {
            const portraitFailures = state.opponentFormation.filter((entry) => entry.portraitKind !== "image"
                || !entry.image?.complete
                || (entry.image?.naturalWidth ?? 0) <= 0
                || (entry.image?.naturalHeight ?? 0) <= 0);
            gate(portraitFailures.length === 0,
                `${label} decodes placement art for every report opponent`, JSON.stringify(portraitFailures));
            const petIds = state.opponentFormation.map((entry) => entry.petId);
            const imageSources = state.opponentFormation.map((entry) => entry.image?.source ?? "");
            gate(petIds.every(Boolean)
                && new Set(petIds).size === state.opponentFormation.length
                && imageSources.every(Boolean)
                && new Set(imageSources).size === new Set(petIds).size,
            `${label} keeps a unique art identity for each distinct opponent`, JSON.stringify({ petIds, imageSources }));
            const clippedOpponentText = state.opponentFormation.flatMap((entry) => [
                { text: entry.pet, ...entry.nameFit },
                { text: entry.cell, ...entry.cellFit },
            ]).filter((entry) => !Number.isFinite(entry.fontPx)
                || entry.fontPx < 13.99
                || entry.scrollWidth > entry.clientWidth
                || entry.textOverflow === "ellipsis");
            gate(clippedOpponentText.length === 0,
                `${label} shows every opponent name and position without clipping or ellipsis`, JSON.stringify(clippedOpponentText));
            const hiddenOpponentRows = state.opponentFormation.filter((entry) => !entry.fullyVisible);
            gate(hiddenOpponentRows.length === 0,
                `${label} keeps all four opponent rows visible together`, JSON.stringify(hiddenOpponentRows));
        }
    }
    const undersizedText = state.textSamples.filter((entry) => !Number.isFinite(entry.fontPx) || entry.fontPx < 13.99);
    gate(state.textSamples.length > 0 && undersizedText.length === 0,
        `${label} keeps all visible report, decision, and control text at least 14px`, JSON.stringify(undersizedText));
    const undersizedTargets = state.actionables.filter((entry) => !entry.box || entry.box.width < 44 || entry.box.height < 44);
    gate(state.actionables.length > 0 && undersizedTargets.length === 0,
        `${label} keeps every visible target at least 44 by 44 CSS px`, JSON.stringify(undersizedTargets));
    gate(state.actionables.every((entry) => entry.centerReachable),
        `${label} keeps every visible target reachable at its center`, JSON.stringify(state.actionables.filter((entry) => !entry.centerReachable)));
    const reportIsOpen = expectedState === "required" || expectedState === "open";
    gate(state.overflowX <= 1 && state.panelOverflowX <= 1 && (!reportIsOpen || state.reportOverflowX <= 1),
        `${label} has no horizontal overflow`, JSON.stringify({ document: state.overflowX, panel: state.panelOverflowX, report: state.reportOverflowX }));
    gate(insideViewport(state.panelBox, state.viewport) && (!reportIsOpen || insideViewport(state.reportBox, state.viewport)),
        `${label} stays inside the safe viewport`, JSON.stringify({ panel: state.panelBox, report: state.reportBox, viewport: state.viewport }));
    const labels = state.actionables.map((entry) => entry.label);
    if (expectedState === "required") {
        gate(labels.includes("Report read, re-form band"), `${label} requires the explicit report acknowledgement`, JSON.stringify(labels));
    } else if (expectedState === "open") {
        gate(labels.includes("Close tactical report"), `${label} exposes the close-report drawer control`, JSON.stringify(labels));
    } else {
        gate(labels.includes("Open tactical report"), `${label} exposes the open-report drawer control`, JSON.stringify(labels));
    }
}

async function readClashIdentity(page) {
    return page.evaluate(() => ({
        hud: document.querySelector(".wfr-duel-no")?.textContent?.trim().replace(/\s+/gu, " ") ?? "",
        formationHold: document.querySelector(".wfr-formation-hold strong")?.textContent?.trim().replace(/\s+/gu, " ") ?? "",
        reportState: document.querySelector('.wfr-reform[aria-label="Tactical report and re-form"]')?.getAttribute("data-mobile-report-state") ?? "absent",
        reportLabel: document.querySelector(".wfr-reform-evidence")?.getAttribute("aria-label") ?? "absent",
    }));
}

async function moveOneReformPet(page, panel, slot = 0) {
    const source = panel.getByLabel("Choose a pet to place").locator("button").nth(slot);
    const petName = (await source.locator("strong").textContent())?.trim() ?? `slot-${slot}`;
    const nodeId = await panel.locator('[data-wfr-legal-drop="true"]').first().getAttribute("data-wfr-node-id");
    const targetCell = panel.locator(`[data-wfr-node-id="${nodeId}"]`);
    await touchTap(page, source);
    await touchTap(page, targetCell);
    const moved = await targetCell.getAttribute("data-wfr-legal-drop") === "false"
        && new RegExp(`occupied by ${petName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "iu").test(await targetCell.getAttribute("aria-label") ?? "");
    return { slot, petName, nodeId: Number(nodeId), moved };
}

async function reachClashOneReport(page, profile) {
    await openDeployment(page, reportTarget);
    if (profile.viewport.width > profile.viewport.height) {
        await acknowledgeLandscapeInspection(page);
    }
    await touchTap(page, page.getByRole("button", { name: "Lock formation" }));
    await page.locator('.wfr-reform[role="dialog"][aria-label="Tactical report and re-form"][data-mobile-report-state="required"]')
        .waitFor({ state: "visible", timeout: 45_000 });
    const identity = await readClashIdentity(page);
    gate(identity.hud === "BEASTBOUND · CLASH 1" && identity.reportLabel === "Clash 1 tactical report",
        `${profile.id} deterministic fast route finishes Clash 1 at the report boundary`, JSON.stringify(identity));
    return identity;
}

async function exerciseReportReform(page, profile, fullTapMatrix) {
    const panel = page.getByRole("dialog", { name: "Tactical report and re-form" });
    const checkpoints = [];
    const checkpoint = async (action) => checkpoints.push({ action, ...(await readClashIdentity(page)) });

    const initial = await readReform(page);
    gateReformSurface(initial, `${profile.id} required report`, "required");
    await checkpoint("Clash 1 report appeared");
    await page.screenshot({ path: path.join(outputDir, `${profile.id}-05-report.png`), type: "png" });

    await touchTap(page, panel.getByRole("button", { name: "Report read, re-form band" }));
    await page.waitForFunction(() => document.querySelector('.wfr-reform[aria-label="Tactical report and re-form"]')
        ?.getAttribute("data-mobile-report-state") === "available");
    await page.waitForTimeout(200);
    const collapsed = await readReform(page);
    gateReformSurface(collapsed, `${profile.id} acknowledged re-form`, "available");
    await checkpoint("Report read and collapsed");

    let tapMatrix = [];
    let firstDraftMove = null;
    if (fullTapMatrix) {
        tapMatrix = await exerciseAllTapPlacements(page, `${profile.id} report-scoped re-form`, panel);
    } else {
        firstDraftMove = await moveOneReformPet(page, panel);
        gate(firstDraftMove.moved, `${profile.id} compatibility re-form accepts a scoped tap move`, JSON.stringify(firstDraftMove));
    }
    let reformed = await readReform(page);
    if (!reformed.diffText.includes("→")) {
        firstDraftMove = await moveOneReformPet(page, panel, 1);
        gate(firstDraftMove.moved, `${profile.id} creates a visible re-form draft`, JSON.stringify(firstDraftMove));
        reformed = await readReform(page);
    }
    gateReformSurface(reformed, `${profile.id} drafted re-form`, "available");
    gate(reformed.diffVisible && reformed.diffText.includes("→"),
        `${profile.id} shows an explicit previous-to-draft formation arrow`, reformed.diffText);
    gateFormationDiff(reformed, collapsed, `${profile.id} drafted re-form`, fullTapMatrix ? 4 : 1);
    await checkpoint(fullTapMatrix ? "Completed the 24-move tap matrix" : "Moved one pet");
    await page.screenshot({ path: path.join(outputDir, `${profile.id}-06-reformed.png`), type: "png" });

    const boardBeforeDrawer = reformed.boardBox;
    const draftBeforeDrawer = reformed.deployment;
    await touchTap(page, panel.getByRole("button", { name: "Open tactical report" }));
    await page.waitForFunction(() => document.querySelector('.wfr-reform[aria-label="Tactical report and re-form"]')
        ?.getAttribute("data-mobile-report-state") === "open");
    const reopenedVisualState = await waitForReopenedReportSettled(page, `${profile.id} reopened report`);
    const reopened = await readReform(page);
    gateReformSurface(reopened, `${profile.id} reopened report`, "open");
    const openBoardDelta = boardBeforeDrawer && reopened.boardBox ? rectDelta(boardBeforeDrawer, reopened.boardBox) : Number.POSITIVE_INFINITY;
    gate(openBoardDelta <= 1 && JSON.stringify(reopened.deployment) === JSON.stringify(draftBeforeDrawer) && reopened.diffText.includes("→"),
        `${profile.id} reopens the report without shifting the board or losing the draft`, JSON.stringify({ boardDelta: openBoardDelta, before: draftBeforeDrawer, after: reopened.deployment, diff: reopened.diffText }));
    await checkpoint("Opened tactical report");
    await page.screenshot({ path: path.join(outputDir, `${profile.id}-07-report-reopened.png`), type: "png" });

    await touchTap(page, panel.getByRole("button", { name: "Close tactical report" }));
    await page.waitForFunction(() => document.querySelector('.wfr-reform[aria-label="Tactical report and re-form"]')
        ?.getAttribute("data-mobile-report-state") === "available");
    await page.waitForTimeout(200);
    const closedAgain = await readReform(page);
    const closeBoardDelta = boardBeforeDrawer && closedAgain.boardBox ? rectDelta(boardBeforeDrawer, closedAgain.boardBox) : Number.POSITIVE_INFINITY;
    gate(closeBoardDelta <= 1 && JSON.stringify(closedAgain.deployment) === JSON.stringify(draftBeforeDrawer) && closedAgain.diffText.includes("→"),
        `${profile.id} closes the report with board geometry and draft intact`, JSON.stringify({ boardDelta: closeBoardDelta, before: draftBeforeDrawer, after: closedAgain.deployment, diff: closedAgain.diffText }));
    await checkpoint("Closed tactical report");

    await page.waitForTimeout(800);
    await checkpoint("Waited without locking");
    await touchTap(page, panel.getByRole("button", { name: "Reset changes" }));
    await page.waitForFunction(() => document.querySelector(".wfr-reform .wfr-formation-diff")?.textContent?.includes("No changes"));
    const reset = await readReform(page);
    gate(JSON.stringify(reset.deployment) === JSON.stringify(collapsed.deployment) && !reset.diffText.includes("→"),
        `${profile.id} Reset changes restores the fought formation`, JSON.stringify({ baseline: collapsed.deployment, reset: reset.deployment, diff: reset.diffText }));
    await checkpoint("Reset changes");

    const finalMove = await moveOneReformPet(page, panel);
    const finalDraft = await readReform(page);
    gate(finalMove.moved && finalDraft.diffVisible && finalDraft.diffText.includes("→"),
        `${profile.id} can move again after Reset before the explicit lock`, JSON.stringify({ finalMove, diff: finalDraft.diffText }));
    gateFormationDiff(finalDraft, collapsed, `${profile.id} post-Reset re-form`, 1);
    await checkpoint("Moved again after Reset");
    await page.waitForTimeout(800);
    await checkpoint("Waited again without locking");

    gate(checkpoints.every((entry) => entry.hud === "BEASTBOUND · CLASH 1"
        && entry.reportLabel === "Clash 1 tactical report"
        && entry.reportState !== "absent"),
    `${profile.id} acknowledgements, moves, drawers, Reset, and delay all remain in Clash 1`, JSON.stringify(checkpoints));

    const preLock = await readClashIdentity(page);
    await touchTap(page, panel.getByRole("button", { name: "Lock & rematch" }));
    await page.locator(".wfr-duel-no", { hasText: "BEASTBOUND · CLASH 2" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.locator('[data-testid="wfr-stage-curtain"][data-stage-ready="true"]').waitFor({ state: "attached", timeout: 35_000 });
    await page.locator('.wfr-canvas canvas[data-rite-board-visible="true"]').waitFor({ state: "visible", timeout: 35_000 });
    const rematch = await readClashIdentity(page);
    gate(preLock.hud === "BEASTBOUND · CLASH 1" && rematch.hud === "BEASTBOUND · CLASH 2" && rematch.reportState === "absent",
        `${profile.id} starts Clash 2 only after the explicit Lock & rematch action`, JSON.stringify({ preLock, rematch }));
    await page.screenshot({ path: path.join(outputDir, `${profile.id}-08-rematch.png`), type: "png" });

    return {
        deterministicTarget: reportTarget,
        initial,
        collapsed,
        tapMatrix,
        firstDraftMove,
        reformed,
        reopened,
        reopenedVisualState,
        openBoardDelta,
        closedAgain,
        closeBoardDelta,
        reset,
        finalMove,
        finalDraft,
        checkpoints,
        preLock,
        rematch,
    };
}

async function readCombat(page, requests) {
    return page.evaluate(() => {
        const rect = (node) => {
            if (!(node instanceof HTMLElement)) return null;
            const box = node.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        const canvas = document.querySelector(".wfr-canvas canvas");
        const hud = document.querySelector(".wfr-hud");
        const numberAttr = (name) => Number(canvas?.getAttribute(name) ?? "NaN");
        const actorLocalHpAnchors = (canvas?.getAttribute("data-rite-actor-local-hp-anchors") ?? "")
            .split(";")
            .filter(Boolean)
            .map((entry) => {
                const [id, x, y, width, height] = entry.split(",");
                return { id, x: Number(x), y: Number(y), width: Number(width), height: Number(height) };
            });
        const controls = [...document.querySelectorAll(".wfr-sound-gate, .wfr-exit")].map((node) => ({
            label: node.getAttribute("aria-label") ?? node.textContent?.trim() ?? "control",
            box: rect(node),
        }));
        return {
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            rootBox: rect(document.querySelector(".wfr-root")),
            canvasBox: rect(canvas),
            hudBox: rect(hud),
            hudHeightRatio: hud instanceof HTMLElement ? hud.getBoundingClientRect().height / innerHeight : Number.NaN,
            controls,
            boardVisible: canvas?.getAttribute("data-rite-board-visible"),
            actorsVisible: Number(canvas?.getAttribute("data-rite-initial-actors-visible") ?? "NaN"),
            actorMode: canvas?.getAttribute("data-rite-actor-render-mode"),
            rigChunkRequested: canvas?.getAttribute("data-rite-rig-chunk-requested"),
            renderCalls: Number(canvas?.getAttribute("data-rite-render-calls") ?? "NaN"),
            actorLocalHpBars: numberAttr("data-rite-actor-local-hp-bars"),
            actorLocalHpBarsMax: numberAttr("data-rite-actor-local-hp-bars-max"),
            actorLocalHpBarsExpected: numberAttr("data-rite-actor-local-hp-bars-expected"),
            actorLocalHpPlayerRails: numberAttr("data-rite-actor-local-hp-player-rails"),
            actorLocalHpEnemyRails: numberAttr("data-rite-actor-local-hp-enemy-rails"),
            actorLocalHpAnchorMode: canvas?.getAttribute("data-rite-actor-local-hp-anchor-mode"),
            actorLocalHpAnchorsMoved: canvas?.getAttribute("data-rite-actor-local-hp-anchors-moved"),
            actorLocalHpAnchors,
            actorLocalHpMinWidthPx: numberAttr("data-rite-actor-local-hp-min-width-px"),
            actorLocalHpMaxWidthPx: numberAttr("data-rite-actor-local-hp-max-width-px"),
            actorLocalHpMinHeightPx: numberAttr("data-rite-actor-local-hp-min-height-px"),
            actorLocalHpTeamColors: canvas?.getAttribute("data-rite-actor-local-hp-team-colors"),
            longTaskSample: canvas?.getAttribute("data-rite-long-task-sample"),
            longTasksOver100ms: Number(canvas?.getAttribute("data-rite-long-tasks-over100ms") ?? "NaN"),
            frameGapsOver100ms: Number(canvas?.getAttribute("data-rite-frame-gaps-over100ms") ?? "NaN"),
        };
    }).then((state) => ({ ...state, requests }));
}

function gateCombat(state, label) {
    const heavyRequests = state.requests.filter((url) => /PetWarfrontRiteStage3D|PetWarfrontSkinnedModel3D|node_modules\/(?:three|@react-three)|warfront-lod/iu.test(url));
    gate(state.boardVisible === "true" && state.actorsVisible === 8,
        `${label} combat frames the board and all eight pets`, `${state.boardVisible} / ${state.actorsVisible}`);
    gate(state.hudHeightRatio <= 0.28, `${label} HUD preserves the battlefield`, `HUD ${(state.hudHeightRatio * 100).toFixed(1)}% of viewport height`);
    gate(state.controls.every((item) => item.box && item.box.width >= 44 && item.box.height >= 44),
        `${label} combat controls meet the 44 CSS px touch floor`, JSON.stringify(state.controls));
    gate(state.actorMode === "model-impostor" && state.rigChunkRequested === "false" && heavyRequests.length === 0,
        `${label} retains the default lightweight Canvas route`, JSON.stringify({ actorMode: state.actorMode, rigChunkRequested: state.rigChunkRequested, renderCalls: state.renderCalls, heavyRequests }));
    const uniqueActorLocalHpIds = new Set(state.actorLocalHpAnchors.map((anchor) => anchor.id));
    gate(state.actorLocalHpBars === 8 && state.actorLocalHpBarsMax === 8 && state.actorLocalHpBarsExpected === 8
        && state.actorLocalHpPlayerRails === 4 && state.actorLocalHpEnemyRails === 4
        && uniqueActorLocalHpIds.size === 8
        && state.actorLocalHpTeamColors === "player:#4cc9f0,enemy:#ff5470",
    `${label} paints actor-local HP rails for both four-pet teams`, JSON.stringify({
        visible: state.actorLocalHpBars,
        maxVisible: state.actorLocalHpBarsMax,
        expected: state.actorLocalHpBarsExpected,
        player: state.actorLocalHpPlayerRails,
        enemy: state.actorLocalHpEnemyRails,
        ids: [...uniqueActorLocalHpIds],
        colors: state.actorLocalHpTeamColors,
    }));
    const actorLocalHpAnchorsInsideCanvas = state.actorLocalHpAnchors.every((anchor) => state.canvasBox
        && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
        && anchor.x >= -2 && anchor.y >= -2
        && anchor.x + anchor.width <= state.canvasBox.width + 2
        && anchor.y + anchor.height <= state.canvasBox.height + 2);
    gate(state.actorLocalHpAnchorMode === "sampled-actor-screen-position"
        && state.actorLocalHpAnchorsMoved === "true"
        && actorLocalHpAnchorsInsideCanvas
        && state.actorLocalHpMinWidthPx >= 38 && state.actorLocalHpMaxWidthPx <= 50
        && state.actorLocalHpMinHeightPx >= 4 && state.actorLocalHpMinHeightPx <= 5,
    `${label} keeps compact HP rails anchored to moving actors`, JSON.stringify({
        mode: state.actorLocalHpAnchorMode,
        moved: state.actorLocalHpAnchorsMoved,
        insideCanvas: actorLocalHpAnchorsInsideCanvas,
        minWidth: state.actorLocalHpMinWidthPx,
        maxWidth: state.actorLocalHpMaxWidthPx,
        minHeight: state.actorLocalHpMinHeightPx,
    }));
}

async function readSustainedCanvasPerformance(page) {
    await page.waitForFunction(() => document.querySelector(".wfr-canvas canvas")
        ?.getAttribute("data-rite-long-task-sample") === "complete", undefined, { timeout: 20_000 });
    return page.evaluate(() => {
        const canvas = document.querySelector(".wfr-canvas canvas");
        return {
            sample: canvas?.getAttribute("data-rite-long-task-sample"),
            longTasksOver100ms: Number(canvas?.getAttribute("data-rite-long-tasks-over100ms") ?? "NaN"),
            longTaskMaxMs: Number(canvas?.getAttribute("data-rite-long-task-max-ms") ?? "NaN"),
            frameGapsOver100ms: Number(canvas?.getAttribute("data-rite-frame-gaps-over100ms") ?? "NaN"),
            frameGapMaxMs: Number(canvas?.getAttribute("data-rite-frame-gap-max-ms") ?? "NaN"),
        };
    });
}

function gateSustainedCanvasPerformance(state, label) {
    gate(state.sample === "complete" && state.longTasksOver100ms === 0 && state.frameGapsOver100ms === 0,
        `${label} sustained Canvas sample has no >100ms stalls`, JSON.stringify(state));
}

async function openDeployment(page, destination = target) {
    await page.route("**/api/perf-beacon", (route) => route.fulfill({ status: 204 }));
    await page.goto(destination, { waitUntil: "domcontentloaded", timeout: 35_000 });
    await page.getByRole("heading", { name: "Set your formation" }).waitFor({ state: "visible", timeout: 35_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll(
        ".wfr-pet-picker .wfr-portrait, .wfr-scout .wfr-portrait, .wfr-placement-grid .wfr-portrait",
    )].every((portrait) => {
        const image = portrait.querySelector("img");
        return portrait.getAttribute("data-wfr-portrait-kind") === "fallback"
            || (image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0);
    }), undefined, { timeout: 35_000 });
}

async function acknowledgeLandscapeInspection(page) {
    await touchTap(page, page.getByRole("button", { name: "Acknowledge matchup and position your band" }));
    await page.waitForFunction(() => document.querySelector(".wfr-deploy")?.getAttribute("data-landscape-inspect-state") === "acknowledged");
}

const browser = await chromium.launch({ headless: true });
try {
    for (const profile of captureProfiles) {
        const context = await browser.newContext({
            viewport: profile.viewport,
            deviceScaleFactor: profile.deviceScaleFactor,
            hasTouch: true,
            isMobile: true,
            colorScheme: "dark",
        });
        const page = await context.newPage();
        const runtimeErrors = [];
        const requests = [];
        page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
        page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`); });
        page.on("request", (request) => requests.push(request.url()));
        await openDeployment(page);

        const initial = await readDeployment(page);
        let boardFirst = initial;
        let drawerEvidence = [];
        if (profile.id === "landscape") {
            gateDeployment(initial, `${profile.id}-inspect`);
            gateLandscapeInspect(initial, profile.id);
            await page.screenshot({ path: path.join(outputDir, `${profile.id}-00-inspect.png`), type: "png" });
            await acknowledgeLandscapeInspection(page);
            boardFirst = await readDeployment(page);
            gateDeployment(boardFirst, profile.id);
            gateLandscapeCompact(boardFirst, profile.id);
        } else {
            gateDeployment(initial, profile.id);
            gatePortraitLandscapeChromeHidden(initial, profile.id);
        }
        const initialBoard = boardFirst.boardBox;
        await page.screenshot({ path: path.join(outputDir, `${profile.id}-01-deploy.png`), type: "png" });
        if (profile.id === "landscape") {
            drawerEvidence = await exerciseLandscapeDrawers(page, outputDir, profile.id, initialBoard);
        }

        let touchEvidence;
        if (profile.id === "portrait") {
            touchEvidence = await exerciseAllTapPlacements(page, profile.id);
            await page.screenshot({ path: path.join(outputDir, `${profile.id}-02-all-pets-tap-moved.png`), type: "png" });
        } else {
            const source = page.getByLabel("Choose a pet to place").locator("button").nth(2);
            const petName = (await source.locator("strong").textContent())?.trim() ?? "pet";
            const targetCell = page.locator('[data-wfr-legal-drop="true"]').first();
            const nodeId = await targetCell.getAttribute("data-wfr-node-id");
            await touchDrag(context, page, source, targetCell, path.join(outputDir, `${profile.id}-02-touch-drag-target.png`));
            const movedCell = page.locator(`[data-wfr-node-id="${nodeId}"]`);
            const moved = await movedCell.getAttribute("data-wfr-legal-drop") === "false"
                && (await movedCell.getAttribute("aria-label") ?? "").includes(petName);
            gate(moved, `${profile.id} supports direct touch drag to an open cell`, `${petName} → node ${nodeId}`);
            touchEvidence = [{ petName, nodeId: Number(nodeId), moved, gesture: "CDP touchStart/touchMove/touchEnd" }];
            await page.screenshot({ path: path.join(outputDir, `${profile.id}-03-touch-drag-moved.png`), type: "png" });
        }

        const afterMove = await readDeployment(page);
        const jitter = initialBoard && afterMove.boardBox ? rectDelta(initialBoard, afterMove.boardBox) : Number.POSITIVE_INFINITY;
        gate(jitter <= 1, `${profile.id} placement has no layout jitter`, `board delta ${round(jitter)}px`);

        const lock = page.getByRole("button", { name: "Lock formation" });
        await touchTap(page, lock);
        await page.locator('[data-testid="wfr-stage-curtain"][data-stage-ready="true"]').waitFor({ state: "attached", timeout: 35_000 });
        await page.locator('.wfr-canvas canvas[data-rite-board-visible="true"]').waitFor({ state: "visible", timeout: 35_000 });
        await page.waitForTimeout(1600);
        await page.screenshot({ path: path.join(outputDir, `${profile.id}-04-clash.png`), type: "png" });
        const combat = await readCombat(page, requests);
        gateCombat(combat, profile.id);
        const performance = await readSustainedCanvasPerformance(page);
        gateSustainedCanvasPerformance(performance, profile.id);
        gate(runtimeErrors.length === 0, `${profile.id} flow is console-clean`, runtimeErrors.join(" | ") || "no errors");

        // Keep the original deployment/combat/performance sample isolated. The
        // post-clash decision proof gets a fresh document with a deterministic,
        // deliberately fast Clash 1 route only after that sample is complete.
        await page.close();
        const reportPage = await context.newPage();
        const reportRuntimeErrors = [];
        reportPage.on("pageerror", (error) => reportRuntimeErrors.push(`pageerror: ${error.message}`));
        reportPage.on("console", (message) => { if (message.type() === "error") reportRuntimeErrors.push(`console: ${message.text()}`); });
        const clashOneReport = await reachClashOneReport(reportPage, profile);
        const reform = await exerciseReportReform(reportPage, profile, true);
        gate(reportRuntimeErrors.length === 0, `${profile.id} report and re-form flow is console-clean`, reportRuntimeErrors.join(" | ") || "no errors");

        report.captures.push({
            id: profile.id,
            cssViewport: profile.viewport,
            deviceScaleFactor: profile.deviceScaleFactor,
            expectedPhysicalCapture: profile.physical,
            initial,
            boardFirst,
            drawerEvidence,
            afterMove,
            jitter,
            touchEvidence,
            combat,
            performance,
            runtimeErrors,
            clashOneReport,
            reform,
            reportRuntimeErrors,
        });
        await context.close();
    }

    for (const profile of compatibilityProfiles) {
        const context = await browser.newContext({ viewport: profile.viewport, hasTouch: true, isMobile: true, colorScheme: "dark" });
        const page = await context.newPage();
        await openDeployment(page);
        const initial = await readDeployment(page);
        let compatibilityEvidence;
        if (profile.id === "compact-landscape") {
            gateDeployment(initial, `${profile.id}-inspect`);
            gateLandscapeInspect(initial, profile.id);
            await acknowledgeLandscapeInspection(page);
            const boardFirst = await readDeployment(page);
            gateDeployment(boardFirst, profile.id);
            gateLandscapeCompact(boardFirst, profile.id);
            compatibilityEvidence = { id: profile.id, initial, boardFirst };
        } else {
            gateDeployment(initial, profile.id);
            gatePortraitLandscapeChromeHidden(initial, profile.id);
            compatibilityEvidence = { id: profile.id, ...initial };
        }
        await page.close();
        const reportPage = await context.newPage();
        const reportRuntimeErrors = [];
        reportPage.on("pageerror", (error) => reportRuntimeErrors.push(`pageerror: ${error.message}`));
        reportPage.on("console", (message) => { if (message.type() === "error") reportRuntimeErrors.push(`console: ${message.text()}`); });
        const clashOneReport = await reachClashOneReport(reportPage, profile);
        const reform = await exerciseReportReform(reportPage, profile, true);
        gate(reportRuntimeErrors.length === 0, `${profile.id} compatibility report flow is console-clean`, reportRuntimeErrors.join(" | ") || "no errors");
        report.compatibility.push({ ...compatibilityEvidence, clashOneReport, reform, reportRuntimeErrors });
        await context.close();
    }
} finally {
    await browser.close();
}

const [html, css] = await Promise.all([
    readFile(path.join(clientDir, "petvfx.html"), "utf8"),
    readFile(path.join(clientDir, "src", "styles", "pet-warfront-rite.css"), "utf8"),
]);
gate(/viewport-fit=cover/u.test(html), "the harness opts into display-cutout safe areas", "petvfx viewport meta");
gate(["top", "right", "bottom", "left"].every((edge) => css.includes(`safe-area-inset-${edge}`)),
    "all four safe-area insets are represented", "top/right/bottom/left");

report.summary = {
    passed: report.gates.filter((entry) => entry.passed).length,
    failed: report.gates.filter((entry) => !entry.passed).length,
    status: errors.length === 0 ? "passed" : "failed",
};
await writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDir, "README.md"), `# Kage mobile report ${evidenceRound} evidence

- Status: **${report.summary.status.toUpperCase()}** (${report.summary.passed} passed, ${report.summary.failed} failed)
- Exact QHD captures: 480 × 1040 CSS at 3× → 1440 × 3120; 1040 × 480 CSS at 3× → 3120 × 1440.
- Baseline proof: the original deployment, touch, combat, actor-local HP, lightweight-renderer, and sustained-performance checks run first without the accelerated report route changing their measurements.
- Deterministic report route: a fresh page then uses 'seed=23&petQuality=low&ritespeed=12&riteqa=1' to finish Clash 1 quickly and stop at the interactive decision boundary.
- Report proof: '-05-report' captures the required "Tactical report and re-form" dialog with three authoritative facts and all four opponent formation rows; '-06-reformed' captures the collapsed draft and visible change arrow; '-07-report-reopened' proves the draft and board geometry survive reopening; '-08-rematch' captures Clash 2 after the explicit lock.
- Mobile state proof: 'data-mobile-report-state' traverses 'required → available → open → available' through "Report read, re-form band" and the Open/Close tactical-report controls.
- Readability and reach proof: every sampled visible report/decision/control label is at least 14 CSS px; every visible report/re-form target is at least 44 × 44 CSS px and center-hit-testable; every expected formation-change row is present, fully inside the diff's effective visible clip, and geometrically clear of the Reset/Lock action region and buttons; panels and open reports stay inside the viewport with no horizontal overflow.
- Decision-boundary proof: all exact and compatibility profiles complete a report-scoped 24/24 tap-move matrix, retain their draft through the report drawer, remain on Clash 1 through acknowledgement, moves, drawers, Reset, and timed waits, then move once more and reach Clash 2 only through "Lock & rematch".
- Compatibility proof: the same required/open/available report gates and '-05' through '-08' captures also run at 412 × 915 and the required 915 × 412 profile.
- Landscape progression proof: the matchup begins expanded, then its acknowledgement yields a board at ≥60% viewport width plus two reachable 44px edge drawers; opening either drawer leaves the board geometry unchanged.
- Portrait isolation proof: the acknowledgement and edge-drawer controls remain absent from the portrait interaction surface.
- Touch proof: every pet traverses every currently legal open cell in each exact report panel, while the baseline still includes its portrait tap matrix and direct landscape touch drag.
- Formation identity proof: decoded lightweight pet art in all 4 picker cards, both revealed scout cards, and all 4 occupied cells; initials are missing-asset fallbacks only.
- Runtime proof: board + 8 actors framed, compact cyan/crimson HP rails anchored to all 8 moving actors, HUD ≤28% of height, 44px controls, and default model-impostor Canvas route with no Three/R3F/rig/LOD request.
- Reference bar: [Riot's TFT Mobile UI notes](https://teamfighttactics.leagueoflegends.com/en-us/news/riot-games/teamfight-tactics-mobile-update/) and [Super Auto Pets on the App Store](https://apps.apple.com/us/app/super-auto-pets/id1597449908).

See \`report.json\` for every measured rectangle, font size, request, gesture, and gate result.
`, "utf8");

console.log(JSON.stringify(report.summary));
if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
}
