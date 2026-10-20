import assert from 'node:assert/strict';
import { clanBossAcceptanceFixture } from './clan-boss-balance-sim.js';
import { normalizePlayerBloodlineJutsus } from '../api/bloodlines/_jutsu-schema.js';
import { bloodlinePoints, pointBudgetForRank } from '../api/_jutsu-points.js';
import { hydrateCharacterFromSave } from '../api/pvp/session.js';
import { jutsuLevelCapForLevel } from '../api/combat-core/formulas.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { auditPressureFixture } from './_pve-pressure-fixture-audit.js';

export type CampaignProfile = 'sustain' | 'pierce' | 'dot' | 'reflection' | 'offense' | 'midgame' | 'no-sustain';
export function campaignFighter(level: number, profile: CampaignProfile) {
    const build = profile === 'offense' || profile === 'midgame' ? profile : 'maxed';
    const fixture = clanBossAcceptanceFixture(level, build);
    const save = fixture.save;
    let finalAudit = fixture.audit;
    const preferred: string[] = [];
    let customAudit: Record<string, unknown> | undefined;
    if (profile === 'no-sustain') {
        const c = save.character;
        c.equipment = { hand: 'rustfang-kunai', body: 'sennin-chest', head: 'sennin-crown', waist: 'sennin-waist', legs: 'sennin-legs', feet: 'sennin-feet' };
        c.inventory = Object.values(c.equipment);
        c.equippedJutsuIds = c.equippedJutsuIds.filter(id => !JUTSU_CATALOG[id]?.tags?.some(t => ['Heal', 'Absorb', 'Siphon', 'Lifesteal'].includes(t.name)));
        const audit = auditPressureFixture(save, level);
        assert.ok(audit.legal && audit.acquisitionWarnings.length === 0, JSON.stringify(audit));
        finalAudit = audit;
    }
    if (['pierce', 'dot', 'reflection'].includes(profile)) {
        assert.equal(level, 100, 'bypass stress profiles use the audited maxed level-100 baseline');
        const raw = profile === 'pierce'
            ? [{ id: 'campaign-pierce', name: 'Campaign Pierce', ap: 60, method: 'AOE_BURST', range: 5, tags: [{ name: 'Pierce', percent: 0 }] }]
            : profile === 'dot'
                ? [{ id: 'campaign-wound', name: 'Campaign Wound', ap: 60, effectPower: 50, tags: [{ name: 'Wound', percent: 35 }, { name: 'Poison', percent: 35 }] },
                    { id: 'campaign-drain', name: 'Campaign Drain', ap: 40, tags: [{ name: 'Drain', percent: 0 }, { name: 'Poison', percent: 35 }] }]
                : [{ id: 'campaign-reflect', name: 'Campaign Reflect', ap: 40, tags: [{ name: 'Reflect', percent: 35 }, { name: 'Absorb', percent: 35 }, { name: 'Decrease Damage Taken', percent: 35 }] }];
        const normalized = normalizePlayerBloodlineJutsus(raw.map(j => ({ type: 'Genjutsu', element: 'Earth', method: 'SINGLE', range: 4, ...j })), 'S Rank');
        assert.equal(normalized.length, raw.length);
        const points = bloodlinePoints(normalized, 'S Rank');
        assert.ok(points <= pointBudgetForRank('S Rank'));
        const bloodline = save.savedBloodlines[0] as Record<string, unknown>;
        bloodline.jutsus = normalized;
        const ids = normalized.map(j => String(j.id));
        // Replace built-in slots, never add free loadout slots or duplicate unique Pierce.
        save.character.equippedJutsuIds.splice(0, ids.length, ...ids);
        save.character.jutsuMastery = save.character.equippedJutsuIds.map(jutsuId => ({ jutsuId, level: jutsuLevelCapForLevel(level), xp: 0 }));
        preferred.push(...ids);
        customAudit = { source: 'canonical player bloodline schema', points, budget: pointBudgetForRank('S Rank'), normalized };
    }
    const hydrated = hydrateCharacterFromSave(save.character, {}, save, null);
    const sealed = hydrated.jutsu as Array<{ id: string; tags?: Array<{ name: string }> }>;
    assert.deepEqual(sealed.map(j => j.id).sort(), [...save.character.equippedJutsuIds].sort());
    return { hydrated, preferred, audit: { ...finalAudit, profile, customAudit,
        baselineAuditBeforeCustomSlotReplacement: !!customAudit, sealedJutsuCount: sealed.length } };
}
