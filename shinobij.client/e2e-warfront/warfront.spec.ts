import { expect, test } from "@playwright/test";

const warfrontUrl = "/petvfx.html?warfront=1&autobuy=balanced&theme=central";
const acceleratedWarfrontUrl = `${warfrontUrl}&wfspeed=30&petQuality=low`;

test("Warfront loads, remembers quality, restarts, and reseeds", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(warfrontUrl);
    await expect(page.getByRole("status")).toBeHidden({ timeout: 12_000 });
    await expect(page.locator("canvas").first()).toBeVisible();

    const quality = page.getByLabel("Warfront visual quality");
    await quality.selectOption("low");
    await expect(quality).toHaveValue("low");
    await page.reload();
    await expect(page.getByRole("status")).toBeHidden({ timeout: 12_000 });
    await expect(page.getByLabel("Warfront visual quality")).toHaveValue("low");

    await page.getByRole("button", { name: /Restart/ }).first().click();
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.getByRole("button", { name: /New match/ }).first().click();
    await expect(page.locator("canvas").first()).toBeVisible();

    expect(pageErrors).toEqual([]);
});

test("an accelerated QA match reaches a complete post-match result", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(acceleratedWarfrontUrl);
    await expect(page.getByRole("status")).toBeHidden({ timeout: 12_000 });
    await expect(page.getByText(/Shatters the Ward Seal|Wins the Judgment|Stalemate/).first()).toBeVisible({ timeout: 55_000 });
    await expect(page.getByText(/MVP/).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
});

test("a missing hound rig falls back without crashing the match", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/pet-models/roster/mythic-4.glb*", (route) =>
        route.fulfill({ status: 404, contentType: "application/octet-stream", body: "" }));

    await page.goto(`${acceleratedWarfrontUrl}`);
    await expect(page.getByRole("status")).toBeHidden({ timeout: 12_000 });
    await expect(page.locator("canvas").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Restart/ }).first()).toBeEnabled();
    expect(pageErrors).toEqual([]);
});

test("the WebGL canvas survives a recoverable context-loss cycle", async ({ page }) => {
    await page.goto(`${acceleratedWarfrontUrl}`);
    await expect(page.getByRole("status")).toBeHidden({ timeout: 12_000 });
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();

    await canvas.evaluate(async (node) => {
        const element = node as HTMLCanvasElement;
        const gl = element.getContext("webgl2") ?? element.getContext("webgl");
        const extension = gl?.getExtension("WEBGL_lose_context");
        if (extension) {
            extension.loseContext();
            await new Promise((resolve) => setTimeout(resolve, 250));
            extension.restoreContext();
            return;
        }
        // Software WebGL runners may omit WEBGL_lose_context; exercise the same
        // canvas lifecycle handlers with the standardized cancelable events.
        element.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 250));
        element.dispatchEvent(new Event("webglcontextrestored"));
    });
    await page.waitForTimeout(900);
    await expect(canvas).toBeVisible();
    await expect(page.getByRole("button", { name: /Restart/ }).first()).toBeEnabled();
});
