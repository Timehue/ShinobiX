/*
 * Source-shape wiring checks, in the style of _human-pvp-loadout.test.ts:
 * exercising the full session-create / tower-fighter-seal HTTP paths needs
 * heavy KV + auth scaffolding, so this instead pins the exact call sites that
 * make ranked 1v1 and ranked 2v2 route through Ranked Format
 * (api/pvp/_ranked-format.ts) rather than each fighter's real stats/gear.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('ranked format wiring', () => {
    it('projects both ranked-1v1 fighters through Ranked Format before hydration', () => {
        const source = read('api/pvp/session.ts');
        // The FIRST hydration of each fighter is untouched (api/_fighter-authority.test.ts
        // pins its exact literal shape), so Ranked Format re-hydrates from a
        // projected save character afterward rather than branching inline.
        assert.match(source, /hydrateCharacterFromSave\(p1Save\.character[^;]*admin\)/s);
        assert.match(source, /hydrateCharacterFromSave\(p2Save\.character[^;]*admin\)/s);
        assert.match(source, /const rankedFormatActive = ranked === true && rankedKind === 'player'/);
        assert.match(
            source,
            /rankedFormatActive && p1Save\?\.character[\s\S]{0,300}projectRankedFormatCharacter\(\s*p1Save\.character[\s\S]{0,400}hydrateCharacterFromSave\(p1SaveCharacter/,
        );
        assert.match(
            source,
            /rankedFormatActive && p2Save\?\.character[\s\S]{0,300}projectRankedFormatCharacter\(\s*p2Save\.character[\s\S]{0,400}hydrateCharacterFromSave\(p2SaveCharacter/,
        );
        assert.match(source, /itemCharges: \{\s*p1: sealRankedFormatItemCharges\(\),\s*p2: sealRankedFormatItemCharges\(\),/);
    });

    it('seals ranked-2v2 fighters through Ranked Format', () => {
        const store = read('api/towers/_pvp-store.ts');
        assert.match(store, /options\.rankedFormat[\s\S]{0,200}projectRankedFormatCharacter\(character, resolveRankedFormatWeaponId\(character\.rankedFormatWeaponId\)\)/);
        assert.match(store, /options\.rankedFormat\s*\?\s*\{ itemCharges: sealRankedFormatItemCharges\(\) \}/);

        const ranked2v2 = read('api/pvp/_ranked-2v2.ts');
        assert.match(ranked2v2, /loadTowerPvpFighter\(slug, \{ consumables: true, rankedFormat: true \}\)/);
    });

    it('adopts the weapon endpoint response through the authoritative save-version path', () => {
        const picker = read('shinobij.client/src/components/RankedFormatWeaponPicker.tsx');
        assert.match(picker, /onVersionedCharacter\(data\.character, data\._saveVersion\)/);

        const district = read('shinobij.client/src/features/arena/components/ArenaDistrictLobby.tsx');
        assert.match(district, /<RankedFormatWeaponPicker character=\{character\} onVersionedCharacter=\{onVersionedCharacter\} \/>/);

        const arena = read('shinobij.client/src/screens/Arena.tsx');
        assert.match(arena, /<ArenaDistrictLobby[\s\S]{0,300}onVersionedCharacter=\{onVersionedCharacter\}/);

        const app = read('shinobij.client/src/App.tsx');
        assert.match(app, /<Arena[\s\S]{0,300}onVersionedCharacter=\{commitVersionedCharacter\}/);
    });

    it('resolves canonical ranked-kit art in both ranked combat renderers', () => {
        const solo = read('shinobij.client/src/screens/PvpBattleScreen.tsx');
        assert.match(solo, /sharedImages\['item:' \+ item\.id\][\s\S]{0,100}starterItemArtworkFor\(item\.id\)/);

        const duo = read('shinobij.client/src/screens/BattleTowerFight.tsx');
        assert.match(duo, /const itemArt = \(it: ItemLike\)[\s\S]{0,180}starterItemArtworkFor\(it\.id \?\? ""\)/);
        assert.match(duo, /central: arenaFloorCentral/);
    });
});
