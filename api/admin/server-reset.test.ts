/*
 * Reset-coverage guard.
 *
 * The reset uses a PRESERVE list, not a wipe list (see the header comment in
 * server-reset.ts): everything is per-era state and is deleted unless it
 * matches something the admin authored. These tests pin both halves —
 * what must survive (the admin's work, the protected accounts, the
 * infrastructure a reset must not break) and what must NOT (every per-player
 * and world namespace, including the ones a future subsystem invents).
 *
 * The old version of this file asserted that a hand-maintained WIPE_PATTERNS
 * array contained certain strings — i.e. it checked the list against itself and
 * could never notice drift. It didn't: an audit on 2026-09-03 found ~795 live
 * rows a "full reset" was leaving behind. The `wipes every player-scoped
 * namespace` case below is the replacement, and it fails closed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PRESERVE_PATTERNS,
    EPHEMERAL_PREFIXES,
    authNamesRequiringRevocation,
    isPreservedKey,
    isProtectedKey,
    isProtectedAccountKey,
    namespaceOf,
    summarizeByNamespace,
} from './server-reset.js';

// ─── what must be DELETED ────────────────────────────────────────────────────

test('wipes every player-scoped namespace found in the live store', () => {
    // Sampled from the production kv_store on 2026-09-03. Every one of these
    // SURVIVED the old wipe-pattern reset; each is either a player's progress,
    // a permanent per-player receipt, or world state from the previous era.
    const mustWipe = [
        // Player progression / ledgers.
        'save:someplayer',
        'ledger:currency:dopey',            // monotonic guard would jam a reused name
        'legacy:stats:dopey',
        'legacy:events:dopey',
        'legacy:sage-pity:dopey',
        'legacy:sage-offer:dopey',
        'legacy:sage-roll:dopey:2026-09-03',
        'story:someplayer',
        // Permanent per-player receipts — the worst class: a returning player
        // could never earn the reward again.
        'tower-firstclear:dopey:1',
        'tower-spire-reward:dopey:w138:3',
        'weekly-board:dopey:w137',
        'receipt:history:dopey',
        'raid-report-count-v2:rill2:2026-09-03',
        'combat-stat-count:someplayer:2026-09-01',
        // Ladders and defence teams belonging to deleted players.
        'petladder:coliseum',
        'petladder:coliseum:def:dopey',
        'petladder:tactical:def:dopey',
        'petgauntlet:lb:w135',
        'ranked:season:current',
        'ranked:season:authority',
        'ranked:season:archive:1',
        // Clans are wiped, so clan history must go with them.
        'clan:storm',
        'clan-boss:week:2026-W27',
        'clan-boss:archive:2026-W27',
        'clan-boss:progress:2026-W27:meow',
        'clan-boss:party-registry:clan:meow',
        'clan-boss-reward:2026-W27:meow',
        'clan-war:leaf-vs-sand',
        // World / economy aggregates from the previous era.
        'era:contrib:bossKills',
        'era:contrib-idempotent:missions',
        'econ:agg:ryo',
        'econ:txns',
        'war:eco:agg:ashen-leaf-village',
        'war:eco:txns',
        'war:settled:abc',
        'world:shrine:ancients',
        'world:footfall:1:2026-09-03',
        'world:territory:12',
        'world:crisis:fourfold-breach-v1',
        'village:intel:frostfangvillage',
        'village:kage:leaf',
        'shared:village-war:frostfangvillage',   // war state, NOT an image
        'shared:sector-war-resolution:pvp-abc',
        // Social graph pointing at deleted accounts.
        'friends:dopey',
        'player-blocks:dopey',
        'dm:inbox:dopey',
        'dm:thread:dopey|rill',                  // composite segment: goes with its other party
        'offline-notices:rui',
        // Credentials + registry.
        'auth:someplayer',
        'auth-google:110000000000000000001',
        'guest-resume:abc',
        'auth-recovery:someplayer',
        'player:registry',
        'player:roster:full',
        'clans:list',
        'bloodlines:list:public',
        // Per-player transient / anti-replay state.
        'missions:daily:someplayer',
        'missions:newbie-daily:shanks2',
        'missions:progress:someplayer:m1',
        'solo-pve:aifight-abc',
        'pve-outcome:story-abc',
        'world-explore-receipt:dopey:abc',
        'world-ai-explore-fight:dopey:abc',
        'pet-sanctuary:nero:meta',
        'raid-territory-proof:abc',
        'training-start-count:someplayer:2026-09-03',
        'beta:funnel:academy.completed:dawdaw', // per-player NX gate; beta:metrics:* is kept
        'economy-settlement:reconciliation-status',
        'hall:nx:kage-first-liberation:leaf',
        'game:announcements',
        'game:announcements-seq',
        'game:village-state:stormveilvillage',
        'game:weekly-boss-state',
    ];
    for (const key of mustWipe) {
        assert.equal(isPreservedKey(key), false, `${key} must NOT survive a full reset`);
    }
});

test('an unknown namespace invented tomorrow is wiped by default', () => {
    // This is the property the old wipe-list model could not provide.
    assert.equal(isPreservedKey('brand-new-subsystem:someplayer:2026-12-01'), false);
    assert.equal(isPreservedKey('whatever'), false);
});

// ─── what must SURVIVE ───────────────────────────────────────────────────────

test('keeps every uploaded image and its manifests', () => {
    for (const key of [
        'shared:img:ai:ashen-dragon',
        'shared:images',
        'shared:imgfields:misc',
        'shared:imgver:avatar',
        'asset:meta:ai:ashen-dragon',
        'img-owner:bloodline:7d8d36c0',
        'image-registry',
    ]) {
        assert.equal(isPreservedKey(key), true, `${key} must survive a full reset`);
    }
});

test('keeps admin-authored content and the exact admin content slots', () => {
    for (const key of [
        'save:admin1',
        'save:admin2',
        'admin:approvedBloodlines',
        'admin:approvedItems',
        'shared:ai-profiles',
        'shared:legacy-defs',
        'game:village-leadership-images',
        'game:weekly-boss-override',
        'forged-item:abc',
    ]) {
        assert.equal(isPreservedKey(key), true, `${key} must survive a full reset`);
    }
});

test('save:admin is matched exactly, not as a prefix', () => {
    // `startsWith('save:admin')` used to spare any account whose slug merely
    // began with "admin". Registration only reserves `admin`, `admin1`,
    // `admin2` and the `admin-` prefix, so `adminx` was registerable and its
    // save survived a full reset — re-register the name, inherit the character.
    assert.equal(isPreservedKey('save:adminx'), false);
    assert.equal(isPreservedKey('save:adminion'), false);
    assert.equal(isPreservedKey('save:admin_smith'), false);
    assert.equal(isPreservedKey('save:admin1'), true);
});

test('keeps backups, deletion fences and session epochs', () => {
    for (const key of [
        'save-snapshot:dopey:1786730882483',
        'backup:save-snapshots:last-success',
        'maxout-backup:save:don',
        'save-delete-version:dopey',   // wiping this would WEAKEN the reset
        'auth-session:someone',        // rotated, never deleted
        'cron:lease:clan-boss-weekly:2026-W36',
    ]) {
        assert.equal(isPreservedKey(key), true, `${key} must survive a full reset`);
    }
});

test('keeps moderation, audit and payment records', () => {
    for (const key of [
        'mod:ban:someone',
        'mod:by-ip:102.32.133.245',
        'mod:by-fp:000252bef916d95128bd27d526a2b8a8',
        'reports:queue',
        'titles:custom-log',
        'player-ip:dopey:79.127.200.33',
        'player-fp:dopey:a73dba46b0751ddb187fb4d2c5d46e74',
        'audit:black-market:1786730882483',
        'beta:metrics:2026-07-07',
        'tebex:orphaned-subscriptions',
    ]) {
        assert.equal(isPreservedKey(key), true, `${key} must survive a full reset`);
    }
});

// ─── protected accounts ──────────────────────────────────────────────────────

test('protected accounts keep their account AND their side-car state', () => {
    // A protected account keeps its save, so everything keyed to that account
    // must stay with it — wiping one side desyncs the pair (an empty legacy
    // tally under a character with recorded legacy events, a frozen currency
    // ledger, gear whose forged definition no longer resolves).
    for (const key of [
        'save:rill', 'auth:rill', 'story:rill',
        'ledger:currency:rill',
        'legacy:stats:rill',
        'tower-firstclear:rill:7',
        'weekly-board:rill:w138',
        'friends:rill',
        'pet-sanctuary:rill:meta',
        'petladder:coliseum:def:rill',
        'save:shanks', 'auth:shanks', 'training-start-count:shanks:2026-09-03',
    ]) {
        assert.equal(isPreservedKey(key), true, `${key} belongs to a protected account`);
    }
    // Ordinary players are wiped clean on all three of the original three.
    assert.equal(isProtectedKey('save:rill'), true);
    assert.equal(isProtectedKey('auth:rill'), true);
    assert.equal(isProtectedKey('story:rill'), true);
    assert.equal(isProtectedKey('save:someplayer'), false);
    assert.equal(isProtectedKey('story:someplayer'), false);
});

test('protected accounts do NOT keep ephemeral session state', () => {
    // A preserved row here would be a ghost: a phantom presence entry, a lock
    // nobody holds, a challenge to a player who no longer exists.
    for (const key of [
        'presence:rill',
        'pvp:pending-session:rill',
        'challenges:rill',
        'chat:village:stormveil-village',
        'lock:save:rill',
        'admin-lock:rill',
        'reset-signal:rill',
        'training-active:shanks',
        'training-token:shanks:7c89e590',
    ]) {
        assert.equal(isPreservedKey(key), false, `${key} is ephemeral and must be cleared`);
    }
});

test('a name that merely contains a protected name is not protected', () => {
    assert.equal(isProtectedAccountKey('save:rillton'), false);
    assert.equal(isProtectedAccountKey('save:notrill'), false);
    assert.equal(isProtectedAccountKey('save:rill'), true);
    assert.equal(isProtectedAccountKey('ledger:currency:rill'), true);
});

// ─── session revocation ──────────────────────────────────────────────────────

test('revokes sessions for deleted auth rows and leaves protected accounts alone', () => {
    assert.deepEqual(
        authNamesRequiringRevocation(['auth:alpha', 'auth:rill', 'auth:beta', 'save:gamma']).sort(),
        ['alpha', 'beta'],
    );
    // The credential-index namespaces are their own rows, not auth rows.
    assert.deepEqual(
        authNamesRequiringRevocation(['auth-google:g-1', 'auth-recovery:x', 'auth-session:y']),
        [],
    );
});

test('session epochs survive so a rotated epoch cannot read back as zero', () => {
    assert.equal(isPreservedKey('auth-session:anyone'), true);
    assert.ok(PRESERVE_PATTERNS.includes('auth-session:*'));
});

// ─── dry-run reporting ───────────────────────────────────────────────────────

test('namespace grouping summarizes by the leading segment', () => {
    assert.equal(namespaceOf('ledger:currency:dopey'), 'ledger');
    assert.equal(namespaceOf('save:dopey'), 'save');
    assert.equal(namespaceOf('tower-firstclear:dopey:1'), 'tower-firstclear');
    assert.equal(namespaceOf('player:registry'), 'player');
    assert.equal(namespaceOf('image-registry'), 'image-registry');
    assert.deepEqual(
        summarizeByNamespace(['save:a', 'save:b', 'legacy:stats:a']),
        { save: 2, legacy: 1 },
    );
});

test('the preserve and ephemeral lists are non-empty and lowercase', () => {
    assert.ok(PRESERVE_PATTERNS.length > 0);
    assert.ok(EPHEMERAL_PREFIXES.length > 0);
    for (const p of PRESERVE_PATTERNS) assert.equal(p, p.toLowerCase(), `${p} must be lowercase`);
    for (const p of EPHEMERAL_PREFIXES) {
        assert.equal(p, p.toLowerCase(), `${p} must be lowercase`);
        assert.ok(p.endsWith(':'), `${p} must be a namespace prefix ending in ':'`);
    }
});
