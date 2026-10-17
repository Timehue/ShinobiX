import type { Page } from '@playwright/test';

/** Restored story scenes can arrive after the destination briefly renders. */
export async function installResumedSceneHandler(page: Page) {
    const scene = page.getByRole('dialog', { name: /visual novel scene/i });
    await page.addLocatorHandler(scene, async () => {
        await scene.getByRole('button', { name: 'Skip', exact: true }).click();
    // Skipping one scene may immediately replace it with another resumed scene.
    // Let the next actionability check invoke the handler again in that case.
    }, { noWaitAfter: true });
}
