import { expect, test, type Route } from '@playwright/test';
import { createRequire } from 'node:module';
import type { RankedPetMatchToken } from '../../api/pet/_ranked-authority';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

const matchToken = '11111111-1111-4111-8111-111111111111';
// The release suites run after the full build. Use that server artifact so
// Playwright does not have to resolve backend .js imports back to TS sources.
const loadServerArtifact = createRequire(import.meta.url);
const { rankedPetReplayForViewer, resolveRankedPetDuel }: typeof import('../../api/pet/_ranked-duel') = loadServerArtifact('../../dist/api/pet/_ranked-duel.js');
const viewer = 'auditninja';
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

for (const mode of ['active', 'completed', 'without-webgl2'] as const) {
    const completed = mode !== 'active';
    const withoutWebGL2 = mode === 'without-webgl2';
    test(`ranked ${withoutWebGL2 ? 'playback without WebGL2' : completed ? 'completed discovery' : 'watch and settlement retries'} presents the viewer result and returns to matchmaking`, async ({ page }) => {
        test.setTimeout(90_000);
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        if (withoutWebGL2) {
            await page.addInitScript(() => {
                const original = HTMLCanvasElement.prototype.getContext;
                HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
                    if (contextId === 'webgl2') return null;
                    return Reflect.apply(original, this, [contextId, ...args]);
                } as typeof original;
            });
        }
        const opponent = completed ? 'zulurival' : 'aardvarkrival';
        const pet = (id: string, templateId: string) => ({ id, name: `${id} fighter`, templateId, rarity: 'standard', level: 40, hp: 900, attack: 120, defense: 70, speed: 80, element: 'Fire', role: 'assassin', jutsus: [] });
        const mine = pet('viewer', 'standard-1');
        const token: RankedPetMatchToken = {
            authority: 'pet-ranked-queue-v1', pairId: matchToken, a: viewer, b: opponent,
            aRating: 1000, bRating: 1000, aPet: mine, bPet: pet('rival', 'standard-2'), seed: 12345, createdAt: 1,
        };
        const resolved = resolveRankedPetDuel(token);
        const script = rankedPetReplayForViewer(token, resolved.script, viewer);
        // Keep terminal recovery bounded. The unavailable-WebGL2 variant also
        // retains the real first round/action to verify that DOM announcements
        // and the playback timer reach the verdict with no Canvas mounted.
        const firstActionIndex = script.events.findIndex(event => event.t === 'action');
        const firstAction = script.events[firstActionIndex];
        const ending = script.events.filter(event => event.t === 'end');
        script.events = withoutWebGL2 ? [...script.events.slice(0, firstActionIndex + 1), ...ending] : ending;
        const save = uiAuditSave();
        save.character = { ...save.character, pets: [mine] };
        const runtime = await installUiAuditRuntime(page, save);
        const updatedCharacter = { ...save.character, petRankedRating: 1012, petRankedWins: 1, pets: [{ ...mine, name: 'Authoritative ranked companion' }] };
        let snapshotPublished = false;
        const publishCharacter = () => {
            if (!snapshotPublished) {
                runtime.commitServerCharacter(updatedCharacter, runtime.currentVersion() + 1);
                snapshotPublished = true;
            }
            return { character: updatedCharacter, _saveVersion: runtime.currentVersion() };
        };
        let acknowledged = false;
        let watchRequests = 0, settlementRequests = 0, acknowledgments = 0;
        await page.route('**/api/pvp/pet-ranked-queue', async route => {
            const body = route.request().postDataJSON();
            if (body.action === 'acknowledge') {
                expect(body.matchToken).toBe(matchToken);
                acknowledgments += 1;
                if (!completed && acknowledgments === 1) return json(route, { error: 'Please retry leaving the replay.' }, 503);
                acknowledged = true;
            }
            return json(route, acknowledged ? { state: 'idle' } : { state: completed ? 'completed' : 'active', matchToken, opponent, initiator: false });
        });
        await page.route('**/api/pet/ranked-watch', route => {
            watchRequests += 1;
            if (!completed && watchRequests === 1) return json(route, { error: 'Temporary watch failure.' }, 503);
            if (completed) publishCharacter();
            return json(route, { ok: true, winnerName: resolved.winnerName, script });
        });
        await page.route('**/api/pet/battle-result', route => {
            settlementRequests += 1;
            if (!completed && settlementRequests === 1) return json(route, { error: 'Please retry recording the ranked result.' }, 503);
            return json(route, { ok: true, ...publishCharacter() });
        });
        if (completed) {
            // Discovery publishes a newer server character during boot, so the
            // generic helper's "last POST is still current" invariant does not
            // apply. The recovery path must adopt that newer GET snapshot.
            // Observe the forced variant before its transient action announcement;
            // late unrelated network activity must not make that beat unobservable.
            await page.goto('/#/petLadder', { waitUntil: withoutWebGL2 ? 'domcontentloaded' : 'networkidle' });
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'petLadder');
        } else {
            await expectUiAuditBoot(page, runtime, 'petLadder');
        }
        const panel = page.getByTestId('pet-ladder-queue');
        if (!completed) {
            await expect(panel.getByRole('alert')).toContainText('could not be loaded');
            await panel.getByRole('button', { name: 'Retry ranked match' }).click();
            await expect(panel.getByRole('alert')).toContainText('retry recording');
            await panel.getByRole('button', { name: 'Retry ranked match' }).click();
        }
        if (withoutWebGL2) {
            expect(firstAction?.t).toBe('action');
            if (firstAction?.t !== 'action') throw new Error('The real ranked fixture must contain an action.');
            await expect(page.getByTestId('pet-showdown-render-fallback')).toBeVisible();
            await expect(page.getByTestId('pet-showdown-root').locator('canvas')).toHaveCount(0);
            await expect(page.getByRole('status').filter({ hasText: `used ${firstAction.moveName}.` })).toContainText('takes');
        }
        const verdict = script.finalState.outcome === 'win' ? 'Victory' : 'Defeat';
        await expect(page.getByRole('dialog', { name: verdict, exact: true })).toBeVisible({ timeout: 45_000 });
        expect(settlementRequests).toBe(completed ? 0 : 2);
        await page.getByRole('button', { name: 'Leave the Showdown', exact: true }).click();
        if (!completed) {
            await expect(panel.getByRole('alert')).toContainText('retry leaving');
            await panel.getByRole('button', { name: 'Return to queue', exact: true }).click();
        }
        await expect(panel.getByRole('button', { name: 'Find ranked match', exact: true })).toBeEnabled();
        // The App's character must adopt the server response/current save;
        // replay-only local state would leave the old roster name here.
        await expect(page.getByText('Authoritative ranked companion', { exact: true }).first()).toBeVisible();
        await expect(page.getByRole('complementary', { name: 'Device and server saves diverged' })).toHaveCount(0);
        expect(acknowledged).toBe(true);
        expect(errors).toEqual([]);
    });
}
