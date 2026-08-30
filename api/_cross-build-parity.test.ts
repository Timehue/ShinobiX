/**
 * Cross-build-root value parity guards (server ⇄ client).
 *
 * api/ (cPanel tsc) and shinobij.client/ (Vite) are separate build roots with no
 * shared module, so several gameplay constants are hand-duplicated and kept in
 * sync only by "keep in sync" comments. This test fails `npm test` if any drifts
 * — closing the gap a shared module would, without the cross-build risk.
 * Companion to api/_combat-formula-parity.test.ts and api/save/_save-clamp-parity.test.ts.
 *
 * Static text analysis only — reads source, imports nothing, opens no DB. Paths
 * resolve from process.cwd() (npm test runs from the repo root), so no import.meta
 * (the cPanel CJS build rejects it).
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const HEAL = read('api', 'player', 'heal.ts');
const PROGRESS = read('api', 'missions', '_progress.ts');
const EVOLUTION = read('api', 'pet', '_evolution.ts');
const EXPEDITION = read('api', 'missions', 'expedition-start.ts');
const PET_EXPEDITION_CONTRACT = read('shared', 'pet-expedition-contract.ts');
const DOCTRINES = read('shinobij.client', 'src', 'lib', 'clan-doctrines.ts');
const PROFESSION = read('shinobij.client', 'src', 'professionLogic.ts');
const PETCONFIG = read('shinobij.client', 'src', 'data', 'pet-config.ts');
const GAME = read('shinobij.client', 'src', 'constants', 'game.ts');
const STATS = read('shinobij.client', 'src', 'lib', 'stats.ts');
const XPENGINE = read('api', '_xp-engine.ts');
const VILLAGE_UP = read('shinobij.client', 'src', 'lib', 'village-upgrades.ts');
const BANK_INT = read('api', '_bank-interest.ts');
const BANK_SCREEN = read('shinobij.client', 'src', 'screens', 'Bank.tsx');
const SERVER_ENTITLEMENTS = read('api', '_entitlements.ts');
const CLIENT_ENTITLEMENTS = read('shinobij.client', 'src', 'lib', 'entitlements.ts');
const CLIENT_PET = read('shinobij.client', 'src', 'lib', 'pet.ts');
const CLIENT_APP = read('shinobij.client', 'src', 'App.tsx');
const PET_POLICY_COPY = [
    read('shinobij.client', 'src', 'screens', 'PetYard.tsx'),
    read('shinobij.client', 'src', 'screens', 'PetArena.tsx'),
    read('shinobij.client', 'src', 'components', 'PetSanctuary.tsx'),
    // PatreonLink.tsx was here until the Patreon rail was removed. The three
    // assertions below are all `doesNotMatch` guards against the retired 3/5
    // pet policy resurfacing in copy, so dropping a deleted source narrows the
    // sweep rather than weakening it.
    read('shinobij.client', 'src', 'data', 'guides.ts'),
].join('\n');

// Extract a (possibly underscore-grouped) number captured by `pattern`.
function numFrom(src: string, pattern: RegExp, label: string): number {
    const m = src.match(pattern);
    assert.ok(m, `${label} not found`);
    return Number(String(m![1]).replace(/_/g, ''));
}

function numArray(src: string, name: string): number[] {
    const m = src.match(new RegExp(name + '\\s*=\\s*\\[([^\\]]*)\\]'));
    assert.ok(m, `array ${name} not found`);
    const nums = m![1].split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n));
    assert.ok(nums.length > 0, `array ${name} parsed empty`);
    return nums;
}

function singleNum(src: string, name: string): number {
    // \b end so DOCTRINE_HOSPITAL_DISCOUNT doesn't match DOCTRINE_HOSPITAL_DISCOUNT_PCT.
    const m = src.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
    assert.ok(m, `constant ${name} not found`);
    return Number(m![1]);
}

// Like singleNum but tolerates a TS type annotation (e.g. `NAME: number = 1`).
function annotatedNum(src: string, name: string): number {
    const m = src.match(new RegExp(name + '(?::\\s*\\w+)?\\s*=\\s*(\\d+)'));
    assert.ok(m, `constant ${name} not found`);
    return Number(m![1]);
}

describe('parity: carried-pet entitlements (server ⇄ client)', () => {
    for (const name of ['PET_CAP_BASE', 'PET_CAP_SUB']) {
        it(`${name} matches`, () => {
            assert.equal(singleNum(SERVER_ENTITLEMENTS, name), singleNum(CLIENT_ENTITLEMENTS, name), `${name} drifted — sync both entitlement modules`);
        });
    }

    it('the base carried roster can field a complete Tactical Arena team', () => {
        assert.ok(
            singleNum(CLIENT_ENTITLEMENTS, 'PET_CAP_BASE') >= singleNum(CLIENT_PET, 'TACTICAL_ARENA_PET_REQUIREMENT'),
            'base pet capacity must not lock free players out of Tactical Arena',
        );
    });

    it('the expedition launch burst covers every supporter carried slot', () => {
        assert.match(EXPEDITION, /enforceRateLimit\(req, res, 'expedition-start', PET_CAP_SUB,/);
    });

    it('client hydration preserves every supporter carried slot', () => {
        assert.match(CLIENT_APP, /pets:\s*\(parsed\.pets \?\? \[\]\)\.map\(normalizePet\)/);
        assert.doesNotMatch(CLIENT_APP, /pets:\s*\(parsed\.pets \?\? \[\]\)\.slice\(/);
    });

    it('Pet Home and supporter copy never advertises the retired 3/5 policy', () => {
        assert.doesNotMatch(PET_POLICY_COPY, /Base:\s*3 carried[^\n]*Supporter:\s*5/i);
        assert.doesNotMatch(PET_POLICY_COPY, /5 Pet Companions[^\n]*up from 3/i);
        assert.doesNotMatch(PET_POLICY_COPY, /carry 3 battle-ready companions[^\n]*5 for Shinobi Supporters/i);
    });
});

describe('parity: Healer rank perk arrays (_progress.ts ⇄ professionLogic.ts)', () => {
    for (const name of ['HEALER_PER_TARGET_COOLDOWN_SEC', 'HEALER_HEAL_XP_BONUS_PCT']) {
        it(`${name} matches (compared by name, order-independent)`, () => {
            assert.deepEqual(numArray(PROGRESS, name), numArray(PROFESSION, name), `${name} drifted — sync both files`);
        });
    }
});

describe('parity: pet evolution stat deltas (_evolution.ts ⇄ pet-evolutions.ts)', () => {
    // Evolution no longer clamps to per-tier caps (HP/ATK/DEF/SPD are uncapped now —
    // training builds them up to the level-100 ceiling), so the mirrored data is the
    // additive tier-gap deltas. Keep the server + client copies identical.
    const PETEVO = read('shinobij.client', 'src', 'data', 'pet-evolutions.ts');
    function objNums(src: string, name: string): Record<string, number> {
        const m = src.match(new RegExp(name + '[^{]*\\{([^}]*)\\}'));
        assert.ok(m, `object ${name} not found`);
        const out: Record<string, number> = {};
        for (const f of m![1].matchAll(/(\w+):\s*(-?\d+)/g)) out[f[1]] = Number(f[2]);
        return out;
    }
    for (const name of ['RARE_DELTA', 'LEGENDARY_DELTA']) {
        it(`${name} matches`, () => {
            const server = objNums(EVOLUTION, name);
            const client = objNums(PETEVO, name);
            for (const stat of ['hp', 'attack', 'defense', 'speed', 'moveRange']) {
                assert.ok(server[stat] !== undefined, `server ${name}.${stat} not parsed`);
                assert.equal(server[stat], client[stat], `${name}.${stat} drifted — sync both evolution files`);
            }
        });
    }
});

describe('parity: pet expedition routes use the shared contract', () => {
    it('server and client derive scout/forage/ruins durations from one source', () => {
        const routes = [...PET_EXPEDITION_CONTRACT.matchAll(/^\s*(scout|forage|ruins):\s*\{[^}]*?durationMinutes:\s*(\d+)/gm)];
        assert.deepEqual(routes.map((match) => match[1]), ['scout', 'forage', 'ruins']);
        assert.deepEqual(routes.map((match) => Number(match[2])), [45, 120, 240]);
        assert.match(EXPEDITION, /PET_EXPEDITION_ROUTES\[expType\]\.durationMinutes/);
        assert.match(PETCONFIG, /PET_EXPEDITION_ROUTES\[type as PetExpeditionType\]\.durationMinutes\s*\*\s*60_000/);
    });
});

describe('parity: medics doctrine hospital discount (heal.ts ⇄ clan-doctrines.ts)', () => {
    it('server DOCTRINE_HOSPITAL_DISCOUNT_PCT matches client DOCTRINE_HOSPITAL_DISCOUNT', () => {
        assert.equal(
            singleNum(HEAL, 'DOCTRINE_HOSPITAL_DISCOUNT_PCT'),
            singleNum(DOCTRINES, 'DOCTRINE_HOSPITAL_DISCOUNT'),
            'medics hospital discount drifted between heal.ts and clan-doctrines.ts',
        );
    });
});

// Guards the BALANCE-CRITICAL XP/level/stat-budget invariant across the two build
// roots. _xp-engine.test.ts already compares the server port against a hand-copied
// replica; this closes the THIRD side — the real client modules (constants/game.ts
// + lib/stats.ts) — so a client-only drift (re-adding the testing boost, changing
// the curve coefficient, or diverging the budget formula) fails npm test.
describe('parity: XP engine constants + formulas (game.ts + stats.ts ⇄ api/_xp-engine.ts)', () => {
    it('CHARACTER_XP_GAIN_MULTIPLIER matches and stays the real ×1 (testing boost off)', () => {
        const client = annotatedNum(GAME, 'CHARACTER_XP_GAIN_MULTIPLIER');
        const server = annotatedNum(XPENGINE, 'CHARACTER_XP_GAIN_MULTIPLIER');
        assert.equal(client, server, 'XP multiplier drifted between game.ts and _xp-engine.ts');
        assert.equal(client, 1, 'XP multiplier is not 1 — the testing boost must stay off in production');
    });
    for (const name of ['MAX_LEVEL', 'MAX_STAT', 'STARTING_STAT_POINTS']) {
        it(`${name} matches across build roots`, () => {
            assert.equal(singleNum(GAME, name), singleNum(XPENGINE, name), `${name} drifted between game.ts and _xp-engine.ts`);
        });
    }
    it('the retired XP curve stays deleted on BOTH sides (no zombie leveling math)', () => {
        // Character XP is retired (docs/leveling-without-xp-map.md). These pins
        // used to guard the 6·L² curve and the linear stat BUDGET; both are
        // deleted now, so the pin inverts: if either formula reappears, someone
        // is rebuilding XP leveling next to the live earned-points curve.
        for (const [label, src] of [['client lib/stats.ts', STATS], ['server api/_xp-engine.ts', XPENGINE]] as const) {
            assert.ok(!src.includes('Math.round(6 * level * level)'), `${label} resurrected the 6·L² xpNeeded curve`);
            assert.ok(!src.includes('STAT_POINTS_FROM_XP_TO_CAP'), `${label} resurrected the XP→stat-budget formula`);
        }
    });
    it('the stat-derived level anchors match on both sides (leveling-without-xp map)', () => {
        // The fitted LEVEL_EARNED_ANCHORS table is THE balance heart of
        // stat-derived leveling — a one-sided tweak silently forks player level
        // between client display and server authority. Pin the literal rows.
        for (const row of ['[1, 0]', '[15, 2800]', '[30, 6200]', '[50, 11600]', '[80, 19600]', '[100, 27500]']) {
            assert.ok(STATS.includes(row), `client lib/stats.ts lost anchor ${row}`);
            assert.ok(XPENGINE.includes(row), `server api/_xp-engine.ts lost anchor ${row}`);
        }
        const interp = 'return aE + Math.round(((clamped - aL) / (bL - aL)) * (bE - aE));';
        assert.ok(STATS.includes(interp), 'client earnedForLevel interpolation drifted');
        assert.ok(XPENGINE.includes(interp), 'server earnedForLevel interpolation drifted');
    });
});

describe('parity: bank interest rate + cap (village-upgrades.ts + Bank.tsx ⇄ api/_bank-interest.ts)', () => {
    it('the per-level bank interest rate matches across build roots', () => {
        const client = numFrom(VILLAGE_UP, /key:\s*"bank"[^}]*?perLevel:\s*([\d.]+)/, 'client bank perLevel');
        const server = numFrom(BANK_INT, /BANK_UPGRADE_PER_LEVEL\s*=\s*([\d.]+)/, 'server BANK_UPGRADE_PER_LEVEL');
        assert.equal(client, server, 'bank interest rate drifted between village-upgrades.ts and _bank-interest.ts');
    });
    it('the interest-earning principal cap matches across build roots', () => {
        const client = numFrom(BANK_SCREEN, /BANK_INTEREST_PRINCIPAL_CAP\s*=\s*([\d_]+)/, 'client BANK_INTEREST_PRINCIPAL_CAP');
        const server = numFrom(BANK_INT, /BANK_INTEREST_PRINCIPAL_CAP\s*=\s*([\d_]+)/, 'server BANK_INTEREST_PRINCIPAL_CAP');
        assert.equal(client, server, 'bank principal cap drifted between Bank.tsx and _bank-interest.ts');
    });
});

describe('parity: pet jutsu-power caps (pet-stats.ts petStatCaps ⇄ api/_pet-stat-ceil.ts PET_JUTSU_POWER_CAP)', () => {
    // The client petStatCaps[rarity].jutsuPower is the authoritative cap that
    // capPetStats enforces; the server clamp (snapshotJutsu in pet-ladder/_core.ts)
    // must mirror it exactly, or a tampered pet seals an over-cap jutsu into the
    // deterministic ranked duel that auto-resolves server-side.
    const PETSTATS = read('shinobij.client', 'src', 'data', 'pet-stats.ts');
    const PETCEIL = read('api', '_pet-stat-ceil.ts');
    const RARITIES = ['standard', 'rare', 'legendary', 'mythic'] as const;
    function clientJutsuPower(rarity: string): number {
        // Scope to the petStatCaps block (the post-training CAPS) — NOT
        // balancedPetBaseStats, which also has a jutsuPower field and appears first.
        const capsBlock = PETSTATS.match(/petStatCaps[^=]*=\s*\{([\s\S]*?)\n\};/);
        assert.ok(capsBlock, 'client petStatCaps block not found');
        const m = capsBlock![1].match(new RegExp(rarity + ':\\s*\\{[^}]*jutsuPower:\\s*(\\d+)'));
        assert.ok(m, `client petStatCaps.${rarity}.jutsuPower not found`);
        return Number(m![1]);
    }
    function serverJutsuPower(rarity: string): number {
        const block = PETCEIL.match(/PET_JUTSU_POWER_CAP[^{]*\{([^}]*)\}/);
        assert.ok(block, 'server PET_JUTSU_POWER_CAP block not found');
        const m = block![1].match(new RegExp(rarity + ':\\s*(\\d+)'));
        assert.ok(m, `server PET_JUTSU_POWER_CAP.${rarity} not found`);
        return Number(m![1]);
    }
    for (const rarity of RARITIES) {
        it(`${rarity} jutsu-power cap matches across build roots`, () => {
            assert.equal(
                serverJutsuPower(rarity), clientJutsuPower(rarity),
                `${rarity} jutsuPower cap drifted between pet-stats.ts and _pet-stat-ceil.ts`,
            );
        });
    }
});

describe('parity: card-pack odds disclosure (Shop.tsx ⇄ api/shop/_settlement.ts PACKS)', () => {
    // Google Play requires the odds of a randomised virtual item to be disclosed
    // before purchase, which binds the moment Fate Shards are purchasable with
    // real money. The disclosure therefore has to track the live PACKS table,
    // not drift from it — this caught the Elite Pack button advertising
    // "(Rare / Epic)" when the server pool was rarities:['epic'] only.
    const SETTLEMENT = read('api', 'shop', '_settlement.ts');
    const SHOP = read('shinobij.client', 'src', 'components', 'Shop.tsx');

    // One literal regex over the whole PACKS table rather than a per-pack
    // RegExp built from a string: the escaping in a constructed pattern is easy
    // to get subtly wrong, and a silently over-permissive guard is worse than none.
    const packRarities = (packId: string): string[] => {
        const rows = [...SETTLEMENT.matchAll(/(\w+):\s*\{[^}]*?rarities:\s*\[([^\]]*)\]/g)];
        const row = rows.find((match) => match[1] === packId);
        assert.ok(row, `${packId} not found in the PACKS table`);
        return row![2].split(',').map((value) => value.trim().replace(/['"]/g, '')).filter(Boolean);
    };

    it('the shop still states pack odds before purchase', () => {
        assert.match(SHOP, /Pack odds:/, 'the pre-purchase odds disclosure was removed');
        assert.match(SHOP, /every card is equally likely/i);
    });

    it('each pack draws exactly the rarities the buttons claim', () => {
        assert.deepEqual(packRarities('standard'), ['common', 'rare']);
        assert.deepEqual(packRarities('epic'), ['epic']);
        assert.deepEqual(packRarities('legendary'), ['legendary']);
    });

    it('the Elite Pack button does not understate its guaranteed rarity', () => {
        // It always yields an Epic; claiming "Rare / Epic" is an inaccurate odds
        // statement even though it errs in the player's favour.
        assert.doesNotMatch(SHOP, /Elite Pack[^<]*Rare\s*\/\s*Epic/i);
        assert.match(SHOP, /Elite Pack — 1 guaranteed Epic card/);
    });

    it('the draw is uniform and unweighted, as the disclosure claims', () => {
        // A weighted table or a pity counter would make the wording false.
        assert.match(SETTLEMENT, /const index = pickIndex\(pool\.length\)/);
        assert.doesNotMatch(SETTLEMENT, /weight|pity|luckBonus/i);
    });
});
