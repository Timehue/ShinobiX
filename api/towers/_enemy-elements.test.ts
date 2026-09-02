import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMY_TEMPLATE_IDS, getEnemyTemplate } from './_enemy-templates.js';

/*
 * Every NPC technique must declare an element.
 *
 * Elemental Seal matches `jutsu.element` against the five basic elements
 * (api/combat-core/resolve-jutsu-action.ts). A jutsu with NO element field is
 * silently unsealable — not by intent, just by omission. That is exactly what
 * had happened: 45 of 67 tower/spire enemy techniques carried no element, so a
 * player's seal did almost nothing to a boss while the same tag shut off all
 * 100 of their own starters. Tagged 2026-09-01.
 *
 * `None` stays legal and is the way to make a technique DELIBERATELY unsealable
 * — five moves use it so their owners keep one action under a seal. The point
 * of this test is that the choice has to be written down, not left implicit.
 */
const VALID_ELEMENTS = new Set(['Earth', 'Wind', 'Water', 'Lightning', 'Fire', 'None']);

describe('enemy template elements', () => {
    it('declares an element on every enemy technique', () => {
        const undeclared: string[] = [];
        for (const templateId of ENEMY_TEMPLATE_IDS) {
            const template = getEnemyTemplate(templateId);
            for (const jutsu of template.jutsu ?? []) {
                if (typeof jutsu.element !== 'string' || jutsu.element.length === 0) {
                    undeclared.push(`${templateId}/${jutsu.id}`);
                }
            }
        }
        assert.deepEqual(undeclared, [], 'these enemy techniques declare no element and are silently unsealable');
    });

    it('uses only elements the seal and weather systems understand', () => {
        const unknown: string[] = [];
        for (const templateId of ENEMY_TEMPLATE_IDS) {
            const template = getEnemyTemplate(templateId);
            for (const jutsu of template.jutsu ?? []) {
                const element = String(jutsu.element ?? '');
                if (element && !VALID_ELEMENTS.has(element)) unknown.push(`${templateId}/${jutsu.id}=${element}`);
            }
        }
        assert.deepEqual(unknown, [], 'enemy techniques must use a basic element or "None"');
    });

    /*
     * Bosses are the case that motivated the tagging, so pin the outcome rather
     * than just the shape: a seal has to actually bite on them. This would have
     * been red before 2026-09-01 for every boss whose only elemental move was
     * already tagged and whose shield/reflect utilities were not.
     */
    it('leaves every boss with at least one sealable technique', () => {
        const BASIC = new Set(['Earth', 'Wind', 'Water', 'Lightning', 'Fire']);
        const unsealableBosses: string[] = [];
        for (const templateId of ENEMY_TEMPLATE_IDS) {
            const template = getEnemyTemplate(templateId);
            const jutsu = template.jutsu ?? [];
            if (!jutsu.length) continue;
            if (template.role !== 'boss' && !templateId.startsWith('clan-boss-')) continue;
            if (!jutsu.some((entry) => BASIC.has(String(entry.element ?? '')))) {
                unsealableBosses.push(templateId);
            }
        }
        assert.deepEqual(unsealableBosses, [], 'a boss with no basic-element technique ignores Elemental Seal entirely');
    });

    /*
     * The mirror of the rule above, and the reason it matters. A sealed PLAYER
     * still has their bloodline kit, Legacy signature, weapon, items and basic
     * attack — Elemental Seal blunts them, it never mutes them. Once every enemy
     * technique carried an element, a sealed three-jutsu boss had nothing left
     * but a basic attack, so one 60 AP cast hard-locked the endgame encounters.
     * Each multi-move boss therefore keeps exactly one unsealable action, always
     * the defensive one, so the seal still removes all of its elemental damage.
     *
     * Single-technique clan bosses are exempt: their scheduled nova/slam/volley
     * strike is a ground mechanic that never goes through the jutsu path, so a
     * seal cannot silence them either.
     */
    it('leaves every multi-technique boss one unsealable action', () => {
        const BASIC = new Set(['Earth', 'Wind', 'Water', 'Lightning', 'Fire']);
        const mutable: string[] = [];
        for (const templateId of ENEMY_TEMPLATE_IDS) {
            const template = getEnemyTemplate(templateId);
            const jutsu = template.jutsu ?? [];
            if (jutsu.length < 2) continue;
            if (template.role !== 'boss' && !templateId.startsWith('clan-boss-')) continue;
            if (jutsu.every((entry) => BASIC.has(String(entry.element ?? '')))) mutable.push(templateId);
        }
        assert.deepEqual(mutable, [], 'one Elemental Seal would silence these bosses entirely');
    });
});
