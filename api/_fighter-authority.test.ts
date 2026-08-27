import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sealTowerFighter } from './towers/_seal.js';
import { hydrateCharacterFromSave } from './pvp/session.js';
import type { AdminCombatContent } from './_admin-content.js';

/*
 * P0-3 fighter-authority guards (docs/audits/combat-authority-audit.md).
 *
 * Phase 0 verified that every server-sealed combat mode funnels through ONE
 * builder — hydrateCharacterFromSave, mostly via sealTowerFighter — and that
 * the two remaining silent-drop hazards were (a) the admin-content parameter
 * defaulting to null (a future caller regresses silently) and (b) unknown
 * equipped jutsu ids dropping with no log. This file pins the fixes and the
 * unification itself.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), 'api', rel), 'utf8');

// Every production caller of the Tower wrapper. Direct Solo-PvE hydrator
// callers are classified separately below.
const SEAL_CALLERS = [
    'towers/start.ts',
    'clan-boss/assault-start.ts',
    '_merc-auto.ts',
] as const;

const DIRECT_HYDRATOR_CALLERS = [
    'village/anbu-infiltration.ts',
    '_anbu-infiltration-store.ts',
] as const;

describe('single fighter pipeline — admin content is always supplied', () => {
    it('every sealTowerFighter production caller loads the admin combat catalog', () => {
        for (const rel of SEAL_CALLERS) {
            const src = read(rel);
            assert.ok(
                /loadAdminCombatContent|admin/.test(src),
                `${rel} must thread the admin combat content into the fighter builder`,
            );
            assert.match(
                src,
                /sealTowerFighter\([^;]*(admin|loadAdminCombatContent)/is,
                `${rel} must pass the admin catalog to sealTowerFighter (the parameter is now required)`,
            );
        }
    });

    it('every direct Solo-PvE hydrator caller loads the admin combat catalog', () => {
        for (const rel of DIRECT_HYDRATOR_CALLERS) {
            const src = read(rel);
            assert.match(
                src,
                /hydrateCharacterFromSave\([^;]*loadAdminCombatContent\(\)/is,
                `${rel} must pass the admin catalog to the canonical hydrator`,
            );
        }
    });

    it('the PvP session passes the admin catalog to the hydrator', () => {
        const src = read('pvp/session.ts');
        assert.match(src, /hydrateCharacterFromSave\(p1Save\.character[^;]*admin\)/s);
        assert.match(src, /hydrateCharacterFromSave\(p2Save\.character[^;]*admin\)/s);
    });

    it('the admin parameter on sealTowerFighter has no default (compile-enforced)', () => {
        const src = read('towers/_seal.ts');
        assert.doesNotMatch(
            src,
            /admin:\s*AdminCombatContent\s*\|\s*null\s*=/,
            'sealTowerFighter must not silently default its admin catalog to null',
        );
    });
});

describe('no fully-silent content drops in loadout resolution', () => {
    it('unknown equipped jutsu ids are logged when dropped', () => {
        const src = read('pvp/session.ts');
        assert.match(src, /\[pvp-loadout\] unresolved equipped jutsu id\(s\)/);
    });

    it('unresolved equipped item ids are logged when dropped', () => {
        const src = read('pvp/session.ts');
        assert.match(src, /\[pvp-items\] unresolved equipped item id\(s\)/);
    });
});

describe('cross-mode fighter parity (the unification contract)', () => {
    // A representative save exercising jutsu resolution, gear resolution,
    // admin-authored content, and stat clamps.
    const authoredJutsu = { id: 'authored-blitz', name: 'Blitz', type: 'Ninjutsu', ap: 40, effectPower: 30 };
    const authoredItem = { id: 'custom-storm-tanto', name: 'Storm Tanto', slot: 'hand', rarity: 'legendary', weaponEp: 40 };
    const admin: AdminCombatContent = {
        jutsu: new Map([[authoredJutsu.id, authoredJutsu]]),
        items: new Map([[authoredItem.id, authoredItem]]),
    };
    const saveChar = {
        name: 'ParityProbe', level: 30, specialty: 'Ninjutsu',
        stats: { ninjutsuOffense: 400, willpower: 200 },
        maxHp: 4000, maxChakra: 3000, maxStamina: 3000,
        bloodline: 'Ashen Eyes',
        equippedJutsuIds: ['ashen-eyes-blood-gaze', 'authored-blitz', 'ghost-jutsu-does-not-exist'],
        jutsuMastery: [
            { jutsuId: 'ashen-eyes-blood-gaze', level: 0 },
            { jutsuId: 'authored-blitz', level: 0 },
            { jutsuId: 'ghost-jutsu-does-not-exist', level: 0 },
        ],
        equipment: { hand: 'custom-storm-tanto', body: 'shinobi-vest' },
        inventory: ['shinobi-vest'],
    };
    const save = { character: saveChar, savedBloodlines: [], creatorJutsus: [], creatorItems: [] };

    it('sealTowerFighter output is the PvP hydration output (plus the specialty clamp)', () => {
        const towers = sealTowerFighter(structuredClone(saveChar), structuredClone(save), {}, admin);
        const pvp = hydrateCharacterFromSave(structuredClone(saveChar), {}, structuredClone(save), admin);
        // The wrapper's ONLY divergence is the specialty whitelist clamp; with a
        // valid specialty the two modes must produce an identical fighter.
        assert.deepEqual(towers, pvp, 'Tower-style and direct Solo-PvE fighters must equal the PvP hydration output');
    });

    it('the shared builder resolves authored content and drops the ghost id for every mode', () => {
        const fighter = sealTowerFighter(structuredClone(saveChar), structuredClone(save), {}, admin);
        const jutsuIds = (fighter.jutsu as Array<{ id: string }>).map((j) => j.id);
        assert.ok(jutsuIds.includes('authored-blitz'), 'admin-authored jutsu sealed');
        assert.ok(!jutsuIds.includes('ghost-jutsu-does-not-exist'), 'unknown id dropped (and logged)');
        const itemIds = (fighter.pvpItems as Array<{ id: string }>).map((i) => i.id);
        assert.ok(itemIds.includes('custom-storm-tanto'), 'admin-authored gear sealed');
    });

    it('withholding the admin catalog is visible in the output (why the param is required)', () => {
        const without = sealTowerFighter(structuredClone(saveChar), structuredClone(save), {}, null);
        const jutsuIds = (without.jutsu as Array<{ id: string }>).map((j) => j.id);
        assert.ok(!jutsuIds.includes('authored-blitz'), 'without the catalog the authored jutsu is lost — the regression the required param prevents');
    });
});
