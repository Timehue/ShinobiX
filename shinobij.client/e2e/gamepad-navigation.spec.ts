import { buildSync } from "esbuild";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const gamepadSource = fileURLToPath(new URL("../src/lib/gamepad-navigation.ts", import.meta.url));
const firstPactSource = readFileSync(new URL("../src/screens/FirstPact.tsx", import.meta.url), "utf8");
const visualNovelSource = readFileSync(new URL("../src/components/CinematicVisualNovelStage.tsx", import.meta.url), "utf8");
const introCinematicSource = readFileSync(new URL("../src/features/intro-cinematic/IntroCinematic.tsx", import.meta.url), "utf8");
const petShowdownSource = readFileSync(new URL("../src/components/PetShowdownBattle.tsx", import.meta.url), "utf8");
const accessibilityCss = readFileSync(new URL("../src/styles/input-accessibility.css", import.meta.url), "utf8");
const gamepadBundle = buildSync({
    entryPoints: [gamepadSource],
    bundle: true,
    format: "iife",
    globalName: "GamepadTestModule",
    write: false,
}).outputFiles[0]?.text;

if (!gamepadBundle) throw new Error("Could not bundle gamepad navigation for browser coverage.");

const controllerTargets = [
    {
        name: "native disclosure summaries",
        markup: '<details id="details"><summary id="target">Field journal</summary></details>',
        verify: async (page: import("@playwright/test").Page) => {
            await expect(page.locator("#details")).toHaveAttribute("open", "");
        },
    },
    {
        name: "custom radio choices",
        markup: '<div id="target" role="radio" aria-checked="false" tabindex="0" onclick="this.setAttribute(\'aria-checked\', \'true\')">Choose shinobi</div>',
        verify: async (page: import("@playwright/test").Page) => {
            await expect(page.locator("#target")).toHaveAttribute("aria-checked", "true");
        },
    },
    {
        name: "custom list options",
        markup: '<div id="target" role="option" aria-selected="false" tabindex="0" onclick="this.setAttribute(\'aria-selected\', \'true\')">Choose route</div>',
        verify: async (page: import("@playwright/test").Page) => {
            await expect(page.locator("#target")).toHaveAttribute("aria-selected", "true");
        },
    },
    {
        name: "Hollow Gate map cells",
        markup: '<div id="neighbor" role="gridcell" aria-label="Walk to relic" tabindex="0" style="position:fixed;left:340px;top:330px" onclick="this.dataset.activated=\'true\'">Relic</div><div id="target" role="gridcell" aria-label="Walk to shrine" tabindex="0" onclick="this.dataset.activated=\'true\'">Shrine</div>',
        afterFocus: async (page: import("@playwright/test").Page) => {
            await page.evaluate(() => {
                const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
                pad.buttons[14] = { pressed: true, value: 1 };
            });
            await expect(page.locator("#neighbor")).toBeFocused();
            await page.evaluate(() => {
                const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
                pad.buttons[14] = { pressed: false, value: 0 };
                pad.buttons[13] = { pressed: false, value: 0 };
            });
            await expect(page.locator("#neighbor")).toHaveCSS("outline-width", "3px");
        },
        verify: async (page: import("@playwright/test").Page) => {
            await expect(page.locator("#neighbor")).toHaveAttribute("data-activated", "true");
            await expect(page.locator("#target")).not.toHaveAttribute("data-activated", "true");
        },
    },
    {
        name: "custom switches",
        markup: '<div id="target" role="switch" aria-checked="false" tabindex="0" onclick="this.setAttribute(\'aria-checked\', \'true\')">Music</div>',
        verify: async (page: import("@playwright/test").Page) => {
            await expect(page.locator("#target")).toHaveAttribute("aria-checked", "true");
        },
    },
    {
        name: "the next enabled action past an aria-disabled link",
        markup: '<a id="blocked" href="#blocked" aria-disabled="true" style="position:fixed;left:360px;top:320px" onclick="this.dataset.activated=\'true\'">Unavailable</a><button id="target" style="position:fixed;left:360px;top:360px" onclick="this.dataset.activated=\'true\'">Continue</button>',
        verify: async (page: import("@playwright/test").Page) => {
            await expect(page.locator("#target")).toHaveAttribute("data-activated", "true");
            await expect(page.locator("#blocked")).not.toHaveAttribute("data-activated", "true");
        },
    },
] as const;

for (const target of controllerTargets) {
    test(`standard controller can focus and activate ${target.name}`, async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 600 });
        await page.setContent(`<!doctype html><html><body><main>${target.markup}</main></body></html>`);
        await page.addStyleTag({ content: "body { margin: 0 } #target { position: fixed; left: 360px; top: 330px }" });
        await page.addStyleTag({ content: accessibilityCss });
        await page.addScriptTag({ content: gamepadBundle });
        await page.evaluate(() => {
            const pad = {
                id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
                axes: [0, 0],
                buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
            };
            Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
            (window as Window & { testGamepad?: typeof pad; stopGamepadNavigation?: () => void }).testGamepad = pad;
            (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
                (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                    .GamepadTestModule.installGamepadNavigation();
        });

        await expect(page.locator("html")).toHaveAttribute("data-gamepad-connected", "true");
        await page.evaluate(() => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[13] = { pressed: true, value: 1 };
        });
        await expect(page.locator("#target")).toBeFocused();
        await expect(page.locator("#target")).toHaveCSS("outline-width", "3px");
        await expect(page.locator("#target")).toHaveCSS("outline-style", "solid");
        if ("afterFocus" in target) await target.afterFocus(page);
        await page.evaluate(() => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[13] = { pressed: false, value: 0 };
        });
        await page.waitForTimeout(40);
        await page.evaluate(() => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[0] = { pressed: true, value: 1 };
        });
        await target.verify(page);
        await page.evaluate(() => {
            (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
        });
    });
}

test("sector left stick uses WASD movement while the D-pad still navigates controls", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<!doctype html><html><body><main data-gamepad-mode="sector"><button id="first">Move</button><button id="second" style="position:fixed;left:480px;top:330px">Map</button></main></body></html>`);
    await page.addStyleTag({ content: "body { margin: 0 } #first { position: fixed; left: 320px; top: 330px }" });
    await page.addStyleTag({ content: accessibilityCss });
    await page.addScriptTag({ content: gamepadBundle });
    await page.evaluate(() => {
        const events: Array<{ code: string; key: string }> = [];
        window.addEventListener("keydown", event => {
            if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) events.push({ code: event.code, key: event.key });
        });
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; movementEvents?: typeof events; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { movementEvents?: typeof events }).movementEvents = events;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
    });

    await page.evaluate(() => {
        (window as Window & { testGamepad: { axes: number[] } }).testGamepad.axes[0] = 1;
    });
    await expect.poll(() => page.evaluate(() =>
        (window as Window & { movementEvents: Array<{ code: string; key: string }> }).movementEvents,
    )).toContainEqual({ code: "KeyD", key: "d" });
    await page.evaluate(() => {
        const pad = (window as Window & { testGamepad: { axes: number[]; buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
        pad.axes[0] = 0;
        pad.buttons[15] = { pressed: true, value: 1 };
    });
    await expect(page.locator("#second")).toBeFocused();
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
});

test("D-pad arrows honor an opted-in custom focus layout before generic spatial navigation", async ({ page }) => {
    expect(petShowdownSource).toMatch(/className="showdown-menu"[^>]*onKeyDown=\{onKeyDown\}[^>]*data-gamepad-arrow-keys="true"/);
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<!doctype html><html><body><main id="menu" data-gamepad-arrow-keys="true"><button id="first">First</button><button id="second">Second</button><button id="third">Third</button></main></body></html>`);
    await page.addStyleTag({ content: "body { margin: 0 } button { position: fixed } #first { left: 350px; top: 180px } #second { left: 350px; top: 290px } #third { left: 520px; top: 290px }" });
    await page.addStyleTag({ content: accessibilityCss });
    await page.addScriptTag({ content: gamepadBundle });
    await page.evaluate(() => {
        document.querySelector<HTMLButtonElement>("#first")!.focus();
        const menu = document.querySelector<HTMLElement>("#menu")!;
        const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
        menu.addEventListener("keydown", event => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[Math.min(buttons.length - 1, current + 2)]?.focus();
        });
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
    });

    await expect(page.locator("#first")).toBeFocused();
    await page.evaluate(() => {
        (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad.buttons[13] = { pressed: true, value: 1 };
    });
    await expect(page.locator("#third")).toBeFocused();
    await expect(page.locator("#second")).not.toBeFocused();
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
});

test("continuous gamepad movement releases on stick center, mode change, page hide, and teardown", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<!doctype html><html><body><main id="world" data-gamepad-mode="sector"></main></body></html>`);
    await page.addScriptTag({ content: gamepadBundle });
    await page.evaluate(() => {
        const events: Array<{ code: string; type: string }> = [];
        window.addEventListener("keydown", event => events.push({ code: event.code, type: event.type }));
        window.addEventListener("keyup", event => events.push({ code: event.code, type: event.type }));
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; movementEvents?: typeof events; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { movementEvents?: typeof events }).movementEvents = events;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
    });

    const events = () => page.evaluate(() =>
        (window as Window & { movementEvents: Array<{ code: string; type: string }> }).movementEvents,
    );
    await page.evaluate(() => {
        (window as Window & { testGamepad: { axes: number[] } }).testGamepad.axes[0] = 1;
    });
    await expect.poll(events).toContainEqual({ code: "KeyD", type: "keydown" });
    await page.evaluate(() => {
        (window as Window & { testGamepad: { axes: number[] } }).testGamepad.axes[0] = 0;
    });
    await expect.poll(events).toContainEqual({ code: "KeyD", type: "keyup" });

    await page.evaluate(() => {
        (window as Window & { testGamepad: { axes: number[] } }).testGamepad.axes[1] = 1;
    });
    await expect.poll(events).toContainEqual({ code: "KeyS", type: "keydown" });
    await page.locator("#world").evaluate(element => element.removeAttribute("data-gamepad-mode"));
    await expect.poll(events).toContainEqual({ code: "KeyS", type: "keyup" });

    await page.locator("#world").evaluate(element => element.setAttribute("data-gamepad-mode", "sector"));
    await page.evaluate(() => {
        const axes = (window as Window & { testGamepad: { axes: number[] } }).testGamepad.axes;
        axes[0] = -1;
        axes[1] = 0;
    });
    await expect.poll(events).toContainEqual({ code: "KeyA", type: "keydown" });
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(events).toContainEqual({ code: "KeyA", type: "keyup" });
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        (window as Window & { testGamepad: { axes: number[] } }).testGamepad.axes[0] = 0;
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(40);
    expect((await events()).filter(event => event.code === "KeyA" && event.type === "keydown")).toHaveLength(1);
    await page.evaluate(() => {
        (window as Window & { testGamepad: { axes: number[] } }).testGamepad.axes[0] = -1;
    });
    await expect.poll(async () => (await events()).filter(event => event.code === "KeyA" && event.type === "keydown").length).toBe(2);
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
    await expect.poll(async () => (await events()).filter(event => event.code === "KeyA" && event.type === "keyup").length).toBe(2);
});

test("disconnecting and reconnecting a controller releases held movement and restores navigation", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<!doctype html><html><body><main data-gamepad-mode="sector"><button id="move">Move</button></main></body></html>`);
    await page.addScriptTag({ content: gamepadBundle });
    await page.evaluate(() => {
        const events: Array<{ code: string; type: string }> = [];
        window.addEventListener("keydown", event => events.push({ code: event.code, type: event.type }));
        window.addEventListener("keyup", event => events.push({ code: event.code, type: event.type }));
        const pad = {
            id: "Hot-plug test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; movementEvents?: typeof events; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { movementEvents?: typeof events }).movementEvents = events;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
    });

    const events = () => page.evaluate(() =>
        (window as Window & { movementEvents: Array<{ code: string; type: string }> }).movementEvents,
    );
    await expect(page.locator("html")).toHaveAttribute("data-gamepad-connected", "true");
    await page.evaluate(() => {
        (window as Window & { testGamepad: { axes: number[] } }).testGamepad.axes[0] = 1;
    });
    await expect.poll(events).toContainEqual({ code: "KeyD", type: "keydown" });

    await page.evaluate(() => {
        const pad = (window as Window & { testGamepad: { connected: boolean } }).testGamepad;
        pad.connected = false;
        window.dispatchEvent(new Event("gamepaddisconnected"));
    });
    await expect.poll(events).toContainEqual({ code: "KeyD", type: "keyup" });
    await expect(page.locator("html")).not.toHaveAttribute("data-gamepad-connected", "true");

    await page.evaluate(() => {
        const pad = (window as Window & { testGamepad: { connected: boolean; axes: number[] } }).testGamepad;
        pad.connected = true;
        pad.axes[0] = 0;
        const event = new Event("gamepadconnected");
        Object.defineProperty(event, "gamepad", { value: pad });
        window.dispatchEvent(event);
    });
    await expect(page.locator("html")).toHaveAttribute("data-gamepad-connected", "true");
    await page.evaluate(() => {
        (window as Window & { testGamepad: { axes: number[] } }).testGamepad.axes[0] = -1;
    });
    await expect.poll(events).toContainEqual({ code: "KeyA", type: "keydown" });
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
    await expect.poll(events).toContainEqual({ code: "KeyA", type: "keyup" });
});

test("the First Pact world enables the contextual walking controls only after entry", () => {
    expect(firstPactSource).toMatch(/className="fp-world"[^>]*data-gamepad-mode=\{entered \? "sector" : undefined\}/);
});

test("cinematic visual-novel stages use controller confirm as their Enter action", async ({ page }) => {
    expect(visualNovelSource).toMatch(/data-gamepad-mode=\{immersive \? "visual-novel" : undefined\}/);
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<!doctype html><html><body>
        <div id="scene" role="dialog" aria-modal="true" tabindex="-1" data-gamepad-mode="visual-novel">
            <button id="setting" onclick="this.dataset.clicked='true'">Text speed</button>
        </div>
    </body></html>`);
    await page.addStyleTag({ content: "body { margin: 0 } #scene { position: fixed; inset: 0; padding: 30px }" });
    await page.addScriptTag({ content: gamepadBundle });
    await page.evaluate(() => {
        const events: Array<{ key: string; target: string }> = [];
        window.addEventListener("keydown", event => events.push({ key: event.key, target: (event.target as HTMLElement).id }));
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; novelKeys?: typeof events; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { novelKeys?: typeof events }).novelKeys = events;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
        document.querySelector<HTMLElement>("#scene")?.focus();
    });

    await expect(page.locator("html")).toHaveAttribute("data-gamepad-connected", "true");
    await page.evaluate(() => {
        (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad.buttons[0] = { pressed: true, value: 1 };
    });
    await expect.poll(() => page.evaluate(() =>
        (window as Window & { novelKeys: Array<{ key: string; target: string }> }).novelKeys,
    )).toContainEqual({ key: "Enter", target: "scene" });

    await page.evaluate(() => {
        const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
        pad.buttons[0] = { pressed: false, value: 0 };
        document.querySelector<HTMLElement>("#setting")?.focus();
    });
    await page.waitForTimeout(40);
    await page.evaluate(() => {
        (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad.buttons[0] = { pressed: true, value: 1 };
    });
    await expect(page.locator("#setting")).toHaveAttribute("data-clicked", "true");
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
});

test("first-launch intro is a controller modal: A advances, D-pad reaches Skip", async ({ page }) => {
    expect(introCinematicSource).toMatch(/role="dialog"[\s\S]*?tabIndex=\{-1\}[\s\S]*?aria-modal="true"[\s\S]*?data-gamepad-mode="visual-novel"/);
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<!doctype html><html><body>
        <div id="intro" role="dialog" aria-modal="true" aria-label="Shinobi Journey opening cinematic" tabindex="-1" data-gamepad-mode="visual-novel" style="position:fixed;inset:0">
            <button id="skip" onclick="this.dataset.skipped='true'">Skip</button>
        </div>
    </body></html>`);
    await page.addScriptTag({ content: gamepadBundle });
    await page.evaluate(() => {
        const intro = document.querySelector<HTMLElement>("#intro")!;
        intro.addEventListener("keydown", event => {
            if (event.key === "Enter") intro.dataset.advanced = String(Number(intro.dataset.advanced ?? "0") + 1);
        });
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
    });

    await expect(page.locator("#intro")).toBeFocused();
    await page.evaluate(() => {
        (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad.buttons[0] = { pressed: true, value: 1 };
    });
    await expect(page.locator("#intro")).toHaveAttribute("data-advanced", "1");
    await page.evaluate(() => {
        const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
        pad.buttons[0] = { pressed: false, value: 0 };
    });
    await page.waitForTimeout(40);
    await page.evaluate(() => {
        (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad.buttons[13] = { pressed: true, value: 1 };
    });
    await expect(page.locator("#skip")).toBeFocused();
    await page.evaluate(() => {
        const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
        pad.buttons[13] = { pressed: false, value: 0 };
    });
    await page.waitForTimeout(40);
    await page.evaluate(() => {
        (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad.buttons[0] = { pressed: true, value: 1 };
    });
    await expect(page.locator("#skip")).toHaveAttribute("data-skipped", "true");
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
});

test("D-pad focus can reach and scroll to actions below the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<!doctype html><html><body><button id="top">Current section</button><div style="height:1000px"></div><button id="below" onclick="this.dataset.activated='true'">Continue below</button></body></html>`);
    await page.locator("#top").focus();
    await page.addScriptTag({ content: gamepadBundle });
    await page.evaluate(() => {
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
    });

    await page.evaluate(() => {
        (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad.buttons[13] = { pressed: true, value: 1 };
    });
    await expect(page.locator("#below")).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.evaluate(() => {
        const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
        pad.buttons[13] = { pressed: false, value: 0 };
    });
    await page.waitForTimeout(40);
    await page.evaluate(() => {
        (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad.buttons[0] = { pressed: true, value: 1 };
    });
    await expect(page.locator("#below")).toHaveAttribute("data-activated", "true");
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
});

test("Rally stick and face/trigger buttons use the existing keyboard action handlers", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<!doctype html><html><body><main data-gamepad-mode="rally"><button id="target">Race</button></main></body></html>`);
    await page.addStyleTag({ content: "body { margin: 0 } #target { position: fixed; left: 360px; top: 330px }" });
    await page.addStyleTag({ content: accessibilityCss });
    await page.addScriptTag({ content: gamepadBundle });
    await page.evaluate(() => {
        const events: Array<{ code: string; type: string }> = [];
        window.addEventListener("keydown", event => events.push({ code: event.code, type: event.type }));
        window.addEventListener("keyup", event => events.push({ code: event.code, type: event.type }));
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; actionEvents?: typeof events; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { actionEvents?: typeof events }).actionEvents = events;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
    });

    await page.evaluate(() => {
        const pad = (window as Window & { testGamepad: { axes: number[]; buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
        pad.axes[0] = 1;
        pad.buttons[2] = { pressed: true, value: 1 };
        pad.buttons[3] = { pressed: true, value: 1 };
        pad.buttons[7] = { pressed: true, value: 1 };
        pad.buttons[6] = { pressed: true, value: 1 };
    });
    await expect.poll(() => page.evaluate(() =>
        (window as Window & { actionEvents: Array<{ code: string; type: string }> }).actionEvents,
    )).toEqual(expect.arrayContaining([
        { code: "ArrowRight", type: "keydown" },
        { code: "KeyQ", type: "keydown" },
        { code: "KeyQ", type: "keyup" },
        { code: "KeyE", type: "keydown" },
        { code: "KeyE", type: "keyup" },
        { code: "Space", type: "keydown" },
        { code: "Space", type: "keyup" },
        { code: "ShiftLeft", type: "keydown" },
    ]));
    await page.evaluate(() => {
        (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad.buttons[6] = { pressed: false, value: 0 };
    });
    await expect.poll(() => page.evaluate(() =>
        (window as Window & { actionEvents: Array<{ code: string; type: string }> }).actionEvents,
    )).toContainEqual({ code: "ShiftLeft", type: "keyup" });
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
});

test("standard controller keeps focus and confirmation inside the topmost modal", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<!doctype html><html><body><button id="background" style="position:fixed;left:20px;top:20px" onclick="this.dataset.activated='true'">Background</button><main role="dialog" aria-modal="true" aria-label="Field journal" style="position:fixed;inset:0"><button id="first" style="position:fixed;left:320px;top:300px">First</button><button id="second" style="position:fixed;left:460px;top:300px" onclick="this.dataset.activated='true'">Second</button></main></body></html>`);
    await page.addStyleTag({ content: "body { margin: 0 }" });
    await page.addStyleTag({ content: accessibilityCss });
    await page.addScriptTag({ content: gamepadBundle });
    await page.evaluate(() => {
        const background = document.querySelector<HTMLButtonElement>("#background")!;
        background.focus();
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
    });

    await expect(page.locator("#first")).toBeFocused();
    await page.evaluate(() => {
        const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
        pad.buttons[15] = { pressed: true, value: 1 };
    });
    await expect(page.locator("#second")).toBeFocused();
    await page.evaluate(() => {
        const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
        pad.buttons[15] = { pressed: false, value: 0 };
    });
    await page.waitForTimeout(40);
    await page.evaluate(() => {
        const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
        pad.buttons[0] = { pressed: true, value: 1 };
    });
    await expect(page.locator("#second")).toHaveAttribute("data-activated", "true");
    await expect(page.locator("#background")).not.toHaveAttribute("data-activated", "true");
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
});

test("standard controller can enter text with the on-screen keyboard and return to the field", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`<!doctype html><html><body><label for="email">Email address</label><input id="email" type="email" maxlength="2" aria-label="Email address"><button id="continue">Continue</button></body></html>`);
    await page.addStyleTag({ content: "body { margin: 0 } label, input, #continue { display: block; margin: 12px; min-height: 44px }" });
    await page.addStyleTag({ content: accessibilityCss });
    await page.addScriptTag({ content: gamepadBundle });
    await page.locator("#email").focus();
    await page.evaluate(() => {
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
    });
    const press = async (index: number) => {
        await page.evaluate(index => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[index] = { pressed: true, value: 1 };
        }, index);
        await page.waitForTimeout(40);
        await page.evaluate(index => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[index] = { pressed: false, value: 0 };
        }, index);
        await page.waitForTimeout(40);
    };

    await press(0);
    const dialog = page.getByRole("dialog", { name: "On-screen keyboard for Email address" });
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-gamepad-text-key="q"]')).toBeFocused();
    await press(13);
    await expect(page.locator('[data-gamepad-text-key="a"]')).toBeFocused();
    await press(0);
    await expect(page.locator("#email")).toHaveValue("a");
    await press(15);
    await expect(page.locator('[data-gamepad-text-key="s"]')).toBeFocused();
    await press(0);
    await expect(page.locator("#email")).toHaveValue("as");
    await press(15);
    await expect(page.locator("#email")).toHaveValue("as", { timeout: 1000 });
    await press(1);
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#email")).toBeFocused();
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
});

test("gamepad keyboard supports numeric entry and never reveals a password", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<!doctype html><html><body><input id="code" type="number" aria-label="Verification code"><input id="password" type="password" aria-label="Password" value="ninja"></body></html>`);
    await page.addStyleTag({ content: accessibilityCss });
    await page.addScriptTag({ content: gamepadBundle });
    await page.locator("#code").focus();
    await page.evaluate(() => {
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
    });
    const press = async (index: number) => {
        await page.evaluate(index => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[index] = { pressed: true, value: 1 };
        }, index);
        await page.waitForTimeout(40);
        await page.evaluate(index => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[index] = { pressed: false, value: 0 };
        }, index);
        await page.waitForTimeout(40);
    };

    await press(0);
    const dialog = page.getByRole("dialog", { name: "On-screen keyboard for Verification code" });
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-gamepad-text-key="1"]')).toBeFocused();
    await press(0);
    await expect(page.locator("#code")).toHaveValue("1");
    await press(15);
    await expect(page.locator('[data-gamepad-text-key="2"]')).toBeFocused();
    await press(0);
    await expect(page.locator("#code")).toHaveValue("12");
    await press(1);
    await expect(dialog).toHaveCount(0);

    await page.locator("#password").focus();
    await page.locator("#password").evaluate((input: HTMLInputElement) => input.setSelectionRange(input.value.length, input.value.length));
    await press(0);
    const passwordDialog = page.getByRole("dialog", { name: "On-screen keyboard for Password" });
    await expect(passwordDialog).toBeVisible();
    await expect(passwordDialog).not.toContainText("ninja");
    await expect(passwordDialog.locator(".gamepad-text-entry-preview")).toHaveText("•••••");
    await passwordDialog.getByRole("button", { name: "⇧" }).click();
    await expect(passwordDialog.locator('[data-gamepad-text-key="q"]')).toHaveText("Q");
    await passwordDialog.locator('[data-gamepad-text-key="q"]').click();
    await expect(page.locator("#password")).toHaveValue("ninjaQ");
    await expect(passwordDialog.locator(".gamepad-text-entry-preview")).toHaveText("••••••");
    await expect(passwordDialog.locator('[data-gamepad-text-key="q"]')).toHaveText("q");
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
});

test("touch gamepad keyboard keeps every key at least 48px and scrolls in short landscape", async ({ browser, browserName }) => {
    test.skip(browserName === "firefox", "Playwright Firefox does not support Android-style isMobile emulation.");
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: "reduce",
    });
    try {
        const page = await context.newPage();
        await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><input id="name" type="text" aria-label="Name"></body></html>`);
        await page.addStyleTag({ content: accessibilityCss });
        await page.addScriptTag({ content: gamepadBundle });
        await page.locator("#name").focus();
        await page.evaluate(() => {
            const pad = {
                id: "Touch target test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
                axes: [0, 0],
                buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
            };
            Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
            (window as Window & { testGamepad?: typeof pad; stopGamepadNavigation?: () => void }).testGamepad = pad;
            (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
                (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                    .GamepadTestModule.installGamepadNavigation();
        });
        const press = async (index: number) => {
            await page.evaluate(index => {
                const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
                pad.buttons[index] = { pressed: true, value: 1 };
            }, index);
            await page.waitForTimeout(40);
            await page.evaluate(index => {
                const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
                pad.buttons[index] = { pressed: false, value: 0 };
            }, index);
            await page.waitForTimeout(40);
        };
        await press(0);
        const dialog = page.getByRole("dialog", { name: "On-screen keyboard for Name" });
        await expect(dialog).toBeVisible();
        await expect.poll(() => page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

        const expectTouchTargets = async () => {
            const dimensions = await dialog.locator(".gamepad-text-entry-key").evaluateAll(buttons =>
                buttons.map(button => {
                    const rect = button.getBoundingClientRect();
                    return { width: rect.width, height: rect.height };
                }));
            expect(dimensions.length).toBeGreaterThan(20);
            for (const rect of dimensions) {
                expect(rect.width).toBeGreaterThanOrEqual(48);
                expect(rect.height).toBeGreaterThanOrEqual(48);
            }
        };
        await expectTouchTargets();

        await page.setViewportSize({ width: 844, height: 390 });
        await expect(dialog).toBeVisible();
        await expectTouchTargets();
        const clear = dialog.getByRole("button", { name: "Clear" });
        await clear.focus();
        await expect(clear).toBeInViewport();
        await page.evaluate(() => {
            (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
        });
    } finally {
        await context.close();
    }
});

test("gamepad keyboard inserts at the contenteditable caret and restores it on return", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<!doctype html><html><body><div id="notes" contenteditable="true" aria-label="Notes">dojo</div></body></html>`);
    await page.addStyleTag({ content: accessibilityCss });
    await page.addScriptTag({ content: gamepadBundle });
    await page.locator("#notes").evaluate((element: HTMLElement) => {
        element.focus();
        const text = element.firstChild!;
        const range = document.createRange();
        range.setStart(text, 1);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
    });
    await page.evaluate(() => {
        const pad = {
            id: "Standard test controller", index: 0, mapping: "standard", connected: true, timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
        (window as Window & { testGamepad?: typeof pad; stopGamepadNavigation?: () => void }).testGamepad = pad;
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation =
            (window as Window & { GamepadTestModule: { installGamepadNavigation: () => () => void } })
                .GamepadTestModule.installGamepadNavigation();
    });
    const press = async (index: number) => {
        await page.evaluate(index => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[index] = { pressed: true, value: 1 };
        }, index);
        await page.waitForTimeout(40);
        await page.evaluate(index => {
            const pad = (window as Window & { testGamepad: { buttons: Array<{ pressed: boolean; value: number }> } }).testGamepad;
            pad.buttons[index] = { pressed: false, value: 0 };
        }, index);
        await page.waitForTimeout(40);
    };

    await press(0);
    const dialog = page.getByRole("dialog", { name: "On-screen keyboard for Notes" });
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-gamepad-text-key="q"]').click();
    await expect(page.locator("#notes")).toHaveText("dqojo");
    await press(1);
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#notes")).toBeFocused();
    await expect.poll(() => page.locator("#notes").evaluate(() => {
        const selection = window.getSelection();
        const element = document.querySelector("#notes")!;
        if (!selection?.anchorNode || !element.contains(selection.anchorNode)) return -1;
        const prefix = document.createRange();
        prefix.selectNodeContents(element);
        prefix.setEnd(selection.anchorNode, selection.anchorOffset);
        return prefix.toString().length;
    })).toBe(2);
    await page.evaluate(() => {
        (window as Window & { stopGamepadNavigation?: () => void }).stopGamepadNavigation?.();
    });
});
