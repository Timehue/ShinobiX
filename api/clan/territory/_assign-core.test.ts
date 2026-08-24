import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    planTerritoryScrollAssignment,
    TERRITORY_CAPTURE_SCROLLS,
    TERRITORY_CONTROL_MAX,
    TERRITORY_CONTROL_SCROLL_ID,
    TERRITORY_HP_MAX,
    type AssignableTerritory,
} from './_assign-core.js';

const now = Date.UTC(2026, 7, 22, 12);

function clan(scrolls = TERRITORY_CAPTURE_SCROLLS, members = 10): Record<string, unknown> {
    return {
        name: 'Storm Clan',
        village: 'Stormveil Village',
        image: 'clan-image',
        members: Array.from({ length: members }, (_, index) => ({ name: `member-${index}` })),
        treasury: {
            ryo: 500,
            items: scrolls > 0 ? [{ itemId: TERRITORY_CONTROL_SCROLL_ID, count: scrolls }] : [],
        },
    };
}

function territory(overrides: Partial<AssignableTerritory> = {}): AssignableTerritory {
    return {
        sector: 40,
        controlScore: 0,
        hp: TERRITORY_HP_MAX,
        terrainBuffStat: 'bukijutsuOffense',
        guards: [],
        warSupply: 0,
        updatedAt: now - 1_000,
        ...overrides,
    };
}

function plan(overrides: Partial<Parameters<typeof planTerritoryScrollAssignment>[0]> = {}) {
    return planTerritoryScrollAssignment({
        clanBefore: clan(),
        clanDisplayName: 'Storm Clan',
        territoryBefore: territory(),
        ownedSectorCount: 0,
        sector: 40,
        count: TERRITORY_CAPTURE_SCROLLS,
        weather: 'rain',
        terrainBuffStat: 'ninjutsuOffense',
        now,
        ...overrides,
    });
}

describe('server-authoritative clan territory scroll planning', () => {
    it('rejects partial deposits on an unclaimed sector so another clan cannot inherit them', () => {
        const result = plan({ clanBefore: clan(5), count: 5 });
        assert.equal(result.ok, false);
        assert.match(result.ok ? '' : result.error, /one committed payment of 75/);
    });

    it('atomically debits 75 scrolls and captures at 75,000 with full HP/weather/terrain', () => {
        const result = plan();
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.territoryAfter.controlScore, TERRITORY_CONTROL_MAX);
        assert.equal(result.territoryAfter.hp, TERRITORY_HP_MAX);
        assert.equal(result.territoryAfter.ownerClan, 'Storm Clan');
        assert.equal(result.territoryAfter.ownerVillage, 'Stormveil Village');
        assert.equal(result.territoryAfter.weather, 'rain');
        assert.equal(result.territoryAfter.terrainBuffStat, 'ninjutsuOffense');
        assert.deepEqual(result.treasury.items, []);
        assert.equal((result.treasury as Record<string, unknown>).ryo, 500);
    });

    it('reinforces an owned sector without applying the capture roster gate', () => {
        const result = plan({
            clanBefore: clan(1, 1),
            territoryBefore: territory({ ownerClan: 'Storm Clan', controlScore: 19_000, hp: 12_000 }),
            ownedSectorCount: 1,
            count: 1,
        });
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.territoryAfter.controlScore, 20_000);
        assert.equal(result.territoryAfter.hp, 13_000);
    });

    it('rejects insufficient scrolls before producing any mutation', () => {
        const result = plan({ clanBefore: clan(0) });
        assert.deepEqual(result, {
            ok: false,
            status: 400,
            error: 'The clan hall needs 75 Territory Control Scrolls.',
        });
    });

    it('preserves the ten-member capture rule, one-sector cap, and rebuild cooldown', () => {
        const roster = plan({ clanBefore: clan(75, 9) });
        assert.equal(roster.ok, false);
        assert.match(roster.ok ? '' : roster.error, /at least 10 members/);

        const duplicateRoster = plan({
            clanBefore: {
                ...clan(75, 10),
                members: [{ name: 'same-member' }, { name: 'Same-Member' }, { name: '' }],
            },
        });
        assert.equal(duplicateRoster.ok, false);
        assert.match(duplicateRoster.ok ? '' : duplicateRoster.error, /currently has 1/);

        const cap = plan({ ownedSectorCount: 1 });
        assert.equal(cap.ok, false);
        assert.match(cap.ok ? '' : cap.error, /only hold one sector/);

        const cooldown = plan({ territoryBefore: territory({ rebuiltAt: now - 60_000 }) });
        assert.equal(cooldown.ok, false);
        assert.match(cooldown.ok ? '' : cooldown.error, /recovering/);
    });

    it('repairs during a breach without moving its fixed deadline', () => {
        const breachedAt = now - 60_000;
        const breachEndsAt = breachedAt + 12 * 60 * 60 * 1_000;
        const result = plan({
            clanBefore: clan(1, 1),
            territoryBefore: territory({
                ownerClan: 'Storm Clan',
                controlScore: TERRITORY_CONTROL_MAX,
                hp: 0,
                breachedAt,
                breachEndsAt,
            }),
            ownedSectorCount: 1,
            count: 1,
        });
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.territoryAfter.hp, 1_000);
        assert.equal(result.territoryAfter.breachedAt, breachedAt);
        assert.equal(result.territoryAfter.breachEndsAt, breachEndsAt);
    });

    it('does not consume a scroll when both owned-sector meters are already full', () => {
        const result = plan({
            territoryBefore: territory({
                ownerClan: 'Storm Clan',
                controlScore: TERRITORY_CONTROL_MAX,
                hp: TERRITORY_HP_MAX,
            }),
            ownedSectorCount: 1,
            count: 1,
        });
        assert.equal(result.ok, false);
        assert.match(result.ok ? '' : result.error, /already at full control and full HP/);
    });

    it('requires the clan village to control the sector before clan capture', () => {
        const result = plan({
            territoryBefore: territory({ ownerVillage: 'Moonshadow Village' }),
        });
        assert.equal(result.ok, false);
        assert.match(result.ok ? '' : result.error, /must win it through a Sector War/);
    });

    it('preserves existing same-village strategic ownership on clan capture', () => {
        const result = plan({
            territoryBefore: territory({ ownerVillage: 'Stormveil Village' }),
        });
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.territoryAfter.ownerVillage, 'Stormveil Village');
    });
});
