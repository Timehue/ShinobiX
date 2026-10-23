import { expect, type Page } from '@playwright/test';

/** Bootstrap may open the sector before a previously visible Return is clicked. */
export async function waitForCurrentSectorMap(page:Page,sector:number) {
    const map=page.locator('.continuous-world-map');
    const back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect(async()=>{
        // Bound the optional click so auto-navigation can win this race. The
        // next observation still requires the actual map to finish loading.
        if(!await map.isVisible()&&await back.isVisible())await back.click({timeout:1000});
        await expect(map).toBeVisible({timeout:1000});
        await expect(map).toHaveAttribute('aria-busy','false',{timeout:1000});
    }).toPass({timeout:60_000});
}

/** Use the same global Travel navigation on desktop and mobile. */
export async function returnToWorldAtlas(page: Page) {
    const info = page.getByRole('dialog', { name: 'Sector Info', exact: true });
    if (await info.isVisible()) {
        await info.getByRole('button', { name: 'Close Sector Info', exact: true }).click();
    }
    await page.getByRole('button', { name: /^(?:Travel|World Map)$/ }).filter({ visible: true }).first().click();
    await expect(page.locator('.world-atlas-card')).toBeVisible();
}
