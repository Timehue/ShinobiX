/*
 * The armor Shield special (Ironwall gear, a named piece's Shield 75-150) is a
 * starting shield. PvP and the Solo PvE family seeded it, but the tower engine
 * (Towers, Spire, clan boss, world boss, caravan, Team Arena, tournaments, Clan
 * War 2v2, village-war mercs) and the sector-war garrison and ANBU vault
 * builders started every fighter at shield 0, so the special did nothing there.
 * These pin the seeding and the round-one timer.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { startingItemShield, shieldExpiryForGrant } from './shields.js';
import { buildTowerEncounter, type SquadMemberInput } from '../towers/_encounter.js';
import { CLAN_BOSS_FLOORS } from '../towers/_floor-catalog.js';
import { createTowerPvpMatch, type TowerPvpFighterSeed } from '../towers/_pvp-session.js';
import { buildInfiltrationEncounter } from '../_anbu-infiltration-encounter.js';
import { buildGarrisonEncounter } from '../_sector-war-garrison-encounter.js';
import { resolveMercBattle } from '../towers/_merc-fighters.js';

const sealed = (itemShield: number) => ({
    level: 100, specialty: 'Taijutsu', maxHp: 1_000, maxChakra: 500, maxStamina: 500,
    stats: {}, jutsu: [], pvpItems: [], equipment: {}, itemShield,
});

describe('startingItemShield', () => {
    it('reads the sealed itemShield and clamps it like PvP does', () => {
        assert.equal(startingItemShield({ itemShield: 150 }), 150);
        assert.equal(startingItemShield({ itemShield: 9_999 }), 5_000);
        assert.equal(startingItemShield({ itemShield: -4 }), 0);
        assert.equal(startingItemShield({ itemShield: 'x' }), 0);
        assert.equal(startingItemShield(null), 0);
    });
});

describe('the gear Shield special is seeded in every engine', () => {
    it('tower encounters (clan boss shown) start the squad with it, timed from round one', () => {
        const squad: SquadMemberInput[] = [{ id: 'hero', name: 'Hero', ownerSlug: 'hero', ai: false, character: sealed(150) }];
        const session = buildTowerEncounter({ floor: CLAN_BOSS_FLOORS[2]!, squad, runId: 'shield-seed', seed: 7, partySize: 1, now: 1 });
        const hero = session.actors.find((actor) => actor.id === 'hero')!;
        assert.equal(hero.shield, 150);
        assert.equal(hero.shieldExpiresAtRound, shieldExpiryForGrant(1));
    });

    it('Tower Team Arena seeds each fighter like a PvP duel', () => {
        const fighter = (slug: string, itemShield: number): TowerPvpFighterSeed => ({ slug, displayName: slug, skill: 1, character: sealed(itemShield) });
        const match = createTowerPvpMatch({
            matchId: `tpvp-${'e'.repeat(32)}`,
            fighters: [fighter('a', 150), fighter('b', 0), fighter('c', 75), fighter('d', 0)],
            seed: 1, now: 1,
        });
        const byOwner = new Map(match.combat.actors.map((actor) => [actor.ownerSlug, actor.shield]));
        assert.deepEqual([byOwner.get('a'), byOwner.get('b'), byOwner.get('c'), byOwner.get('d')], [150, 0, 75, 0]);
    });

    it('the ANBU vault raid and the garrison assault seed both sealed loadouts, like the duel they stand in for', () => {
        const vault = buildInfiltrationEncounter({
            runId: 'infil-shield', now: 1,
            raider: { slug: 'rill', name: 'Rill', character: sealed(120) },
            anbu: { slug: 'anbu', name: 'The Frostfang Anbu', character: sealed(500) },
            terrain: 'forest', sector: 12, targetVillage: 'Frostfang Village',
        });
        const garrison = buildGarrisonEncounter({
            runId: 'garrison-shield', now: 1,
            attacker: { slug: 'rill', name: 'Rill', character: sealed(120) },
            anbu: { slug: 'anbu', name: 'Frostfang Anbu #1', character: sealed(500) },
            terrain: 'forest', sector: 12, contestId: '12:moonshadowvillage-vs-frostfangvillage',
            attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village',
        });
        for (const session of [vault, garrison]) {
            assert.equal(session.player.shield, 120);
            assert.equal(session.player.shieldExpiresAtRound, shieldExpiryForGrant(1));
            assert.equal(session.enemy.shield, 500);
        }
    });

    it('a village-war merc battle starts the defending player with it', () => {
        // Same seed, same fighters: only the gear shield differs, so the first hit
        // the merc lands must read differently once the shield soaks it.
        const fight = (itemShield: number) => resolveMercBattle({ playerName: 'Rill', playerSlug: 'rill', playerSealedChar: sealed(itemShield), mercLevel: 80, seed: 7, now: 1 }).log.join('\n');
        assert.notEqual(fight(150), fight(0), 'the defender carried the seeded shield into the fight');
    });
});
