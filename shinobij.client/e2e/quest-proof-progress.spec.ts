import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { rollWanderers, wandererDayBucketFromMs } from '../../shared/wanderer-roster';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';

for (const verified of [false, true]) test(`epic boss progress uses its fight receipt (${verified ? 'verified win' : 'unrelated wins'})`, async ({ page }, info) => {
    // Pin a known quest-giver window rather than depending on today's roll.
    const now = Date.UTC(2026, 9, 20, 6);
    await page.clock.setFixedTime(now);
    const bucket = wandererDayBucketFromMs(now);
    const sector = Array.from({ length: 60 }, (_, i) => i + 1).find(id => rollWanderers(id, bucket).some(w => w.verb === 'quest'))!;
    const giver = rollWanderers(sector, bucket).find(w => w.verb === 'quest')!;
    const save = uiAuditSave();
    save.currentSector = sector; save.currentTile = giver.homeTile; save.worldGeoV = 2;
    const cooldowns = quietRoadCooldowns(Array.from({ length: 66 }, (_, i) => i + 1), now);
    delete cooldowns[giver.id];
    save.wandererCooldowns = cooldowns;
    save.character = { ...save.character, totalAiKills: 500,
        activeQuestbook: { id: 'qb-bell', stage: 3, baseline: 10, target: 1, choices: { curse: 'cleanse' } },
        worldAiContextWins: verified ? [{ kind: 'questbook-boss', sourceId: 'qb-bell', stage: 3, sealVersion: 'qb-bell:3:10:1234', proofId: 'verified-wraith' }] : [],
    };
    await installUiAuditRuntime(page, save);
    await page.goto('/#/worldMap');
    const returnButton = page.getByRole('button', { name: 'Return to sector' });
    await expect.poll(async () => await returnButton.isVisible() || await page.locator('.sector-image-map').isVisible()).toBe(true);
    if (await returnButton.isVisible()) await returnButton.click();
    const objective = page.getByText("Defeat the Bell-Wraith using this quest's Fight button to stop the temple guardian.", { exact: true });
    if (!await objective.isVisible()) await page.locator('.sector-wanderer-figure').filter({ has: page.locator(`img[alt="${giver.name}"]`) }).dispatchEvent('click');
    await expect(objective).toBeVisible();
    const card = page.locator('.card').filter({ has: objective });
    await expect(card).toContainText(`Progress: ${verified ? 1 : 0} / 1 AI battles won`);
    await expect(card.getByRole('button', { name: 'Claim reward', exact: true })).toHaveCount(verified ? 1 : 0);
    await page.screenshot({ path: info.outputPath('quest-proof-progress.png'), fullPage: true });
});
