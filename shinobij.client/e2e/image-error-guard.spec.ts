import { expect, test, type Page } from "@playwright/test";
import { IMAGE_GUARD_ATTRIBUTE } from "../src/lib/imageErrorGuard";
import { expectUiAuditBoot, installUiAuditRuntime } from "./helpers/ui-audit-runtime";

// src/lib/imageErrorGuard.ts hides a failed same-origin image, retries it, and
// marks the element so a hidden failure can be told apart from an image the
// page hid on purpose. The artwork audit in non-combat-ui-audit.spec.ts relies
// on these marks.

type ProbeOptions = {
    /** An inline display the page set itself, as React does for style={{ display }}. */
    inlineDisplay?: string;
    /** Hide the image from its own error handler, as ~50 components' onError do. */
    hideOnError?: boolean;
};

/** Mounts a probe <img> and records every value its guard mark takes. */
async function mountProbe(page: Page, src: string, { inlineDisplay = "", hideOnError = false }: ProbeOptions = {}) {
    await page.evaluate(({ src, attribute, inlineDisplay, hideOnError }) => {
        const img = document.createElement("img");
        img.id = "image-guard-probe";
        img.alt = "";
        img.width = 64;
        img.height = 64;
        if (inlineDisplay) img.style.display = inlineDisplay;
        // Element listeners run after the guard's window capture listener,
        // exactly where a React onError handler runs.
        if (hideOnError) img.addEventListener("error", () => { img.style.display = "none"; });
        // attributeOldValue lets the full sequence be rebuilt even if two
        // changes land in one task: each record holds the value it replaced.
        const replaced: (string | null)[] = [];
        new MutationObserver((records) => records.forEach((record) => replaced.push(record.oldValue)))
            .observe(img, { attributes: true, attributeFilter: [attribute], attributeOldValue: true });
        (window as unknown as { __guardMarks: () => (string | null)[] }).__guardMarks = () =>
            [...replaced.slice(1), img.getAttribute(attribute)];
        img.src = src;
        document.body.append(img);
    }, { src, attribute: IMAGE_GUARD_ATTRIBUTE, inlineDisplay, hideOnError });
    return {
        image: page.locator("#image-guard-probe"),
        marks: () => page.evaluate(() => (window as unknown as { __guardMarks: () => (string | null)[] }).__guardMarks()),
    };
}

// The DOM leaves Window out of a "load" event's path, so a guard that listened
// for the retry's load on window never saw it. Every image that recovered then
// stayed hidden until its element was replaced, so a phone that dropped one
// request kept a blank slot where the artwork belonged.
test("a same-origin image that recovers on retry is shown again", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page);
    const attempts: string[] = [];
    await page.route((url) => url.searchParams.has("guard-probe"), (route) => {
        attempts.push(new URL(route.request().url()).search);
        return attempts.length === 1 ? route.abort("failed") : route.continue();
    });
    await expectUiAuditBoot(page, runtime, "village");

    const probe = await mountProbe(page, "/bloodline-ashen-eyes.webp?guard-probe=1");
    await expect.poll(() => attempts.length, "the guard should retry the failed image once").toBe(2);
    expect(attempts[1]).toContain("__img_retry=1");
    await expect.poll(() => probe.image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(probe.image, "the recovered image must not stay hidden").toBeVisible();
    await expect.poll(probe.marks, "a recovered image drops its guard mark").toEqual(["retrying", null]);
});

// React writes style={{ display: "block" }} once and never re-applies an
// unchanged style, so a restore that deletes the property leaves the image in
// the wrong layout for good. It must put back what the page had, even when the
// page's own onError hid the image after the guard did.
test("a recovered image gets back the inline display the page gave it", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page);
    let attempts = 0;
    await page.route((url) => url.searchParams.has("guard-probe"), (route) => {
        attempts += 1;
        return attempts === 1 ? route.abort("failed") : route.continue();
    });
    await expectUiAuditBoot(page, runtime, "village");

    const probe = await mountProbe(page, "/bloodline-ashen-eyes.webp?guard-probe=1", { inlineDisplay: "inline-block", hideOnError: true });
    await expect.poll(probe.marks).toEqual(["retrying", null]);
    await expect(probe.image).toBeVisible();
    expect(await probe.image.evaluate((img: HTMLImageElement) => [img.style.getPropertyValue("display"), img.style.getPropertyPriority("display")]))
        .toEqual(["inline-block", ""]);
});

// Achievement badges hide themselves on error (visibility, so the emoji behind
// shows through). The guard's restore only undoes its own display, so without
// the badge's onLoad a recovered badge stayed invisible over its emoji.
test("an achievement badge that recovers on retry covers its emoji again", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page);
    const attempts: string[] = [];
    await page.route((url) => url.pathname === "/badges/level-10.webp", (route) => {
        attempts.push(new URL(route.request().url()).search);
        return attempts.length === 1 ? route.abort("failed") : route.continue();
    });
    await expectUiAuditBoot(page, runtime, "profile");
    await page.locator(".profile-mobile-tabs").getByRole("button", { name: "Achievements" }).click();

    const badge = page.locator('.achievements-grid img[src*="/badges/level-10.webp"]');
    await badge.scrollIntoViewIfNeeded();
    await expect.poll(() => attempts.length, "the guard should retry the failed badge once").toBe(2);
    await expect.poll(() => badge.evaluate((img: HTMLImageElement, attribute) => ({
        loaded: img.complete && img.naturalWidth > 0,
        visibility: getComputedStyle(img).visibility,
        display: getComputedStyle(img).display,
        mark: img.getAttribute(attribute),
    }), IMAGE_GUARD_ATTRIBUTE)).toEqual({ loaded: true, visibility: "visible", display: "block", mark: null });
});

// A body that is not an image fails to decode without any console error or
// 404, so this failure is only visible through the guard's mark.
test("a same-origin image that never loads is marked failed after its retry", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page);
    const attempts: string[] = [];
    await page.route((url) => url.searchParams.has("guard-probe"), (route) => {
        attempts.push(new URL(route.request().url()).search);
        return route.fulfill({ status: 200, contentType: "image/webp", body: "not a webp" });
    });
    await expectUiAuditBoot(page, runtime, "village");

    const probe = await mountProbe(page, "/bloodline-ashen-eyes.webp?guard-probe=1");
    await expect.poll(probe.marks, "the guard should retry once, then give up").toEqual(["retrying", "failed"]);
    expect(attempts).toEqual(["?guard-probe=1", "?guard-probe=1&__img_retry=1"]);
    await expect(probe.image, "the guard hides an image it gave up on").toBeHidden();
});
