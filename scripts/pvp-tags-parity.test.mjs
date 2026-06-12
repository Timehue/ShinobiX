/*
 * Drift guard: the server canonical PvP tag contract (api/pvp/_tags.ts) MUST
 * stay consistent with the client tag tables (shinobij.client/src/lib/tags.ts).
 * The two live in separate build roots with no shared module, so this test —
 * which loads BOTH via tsx's require hook — is the only thing tying them
 * together. If aliases, the rank-capped tag list, or the builder's offered tags
 * drift apart, `npm test` fails here.
 *
 * Lives in scripts/ (excluded from both build roots) for the same reason
 * scripts/jutsu-catalog.test.mjs does: importing client + server source here
 * never pulls cross-root files into either dist.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const server = require('../api/pvp/_tags.ts');
const client = require('../shinobij.client/src/lib/tags.ts');

const sorted = (xs) => [...xs].sort();

describe('PvP tag parity (server ⇄ client)', () => {
    it('the five aliases resolve identically on both sides', () => {
        for (const [alias, target] of Object.entries(server.TAG_ALIASES)) {
            assert.equal(
                client.normalizeTagName(alias), target,
                `client normalizeTagName('${alias}') must equal server canonical '${target}'`,
            );
        }
        // And the client invents no extra aliases for any server-known name.
        for (const name of server.KNOWN_TAG_NAMES) {
            const clientCanonical = client.normalizeTagName(name);
            const serverCanonical = server.canonicalTagName(name);
            assert.equal(clientCanonical, serverCanonical, `alias drift on '${name}'`);
        }
    });

    it('the rank-capped tag set matches (CAPPED_AMP_TAGS ⇄ cappedDamageTags)', () => {
        assert.deepEqual(sorted(server.CAPPED_AMP_TAGS), sorted(client.cappedDamageTags));
    });

    it('the opponent-affecting tag set matches (drives client/server targeting parity)', () => {
        assert.deepEqual(sorted(server.OPPONENT_AFFECTING_TAGS), sorted(client.opponentAffectingTags));
    });

    it('every tag the bloodline builder can offer is a known server tag', () => {
        for (const name of client.allTags) {
            assert.ok(
                server.KNOWN_TAG_NAMES.has(name),
                `client allTags offers '${name}' but the server would reject it`,
            );
            assert.equal(
                server.canonicalTagName(name), name,
                `client allTags entry '${name}' is an alias — it must be canonical`,
            );
        }
    });

    it('the fixed-effect-power tag set matches (server jutsuHasFixedEffectPower ⇄ client hasFixedEffectPower)', () => {
        // The client keeps the set module-private, so compare behaviourally: every
        // server fixed-effect tag must read as fixed-effect on the client, and a
        // pure-damage tag must not — on both sides.
        for (const name of server.FIXED_EFFECT_POWER_TAGS) {
            assert.ok(client.hasFixedEffectPower({ tags: [{ name }] }), `client: ${name} should be fixed-effect`);
            assert.ok(server.jutsuHasFixedEffectPower([{ name }]), `server: ${name} should be fixed-effect`);
        }
        for (const name of ['Wound', 'Increase Damage Given', 'Heal', 'Reflect']) {
            assert.ok(!client.hasFixedEffectPower({ tags: [{ name }] }), `client: ${name} must NOT be fixed-effect`);
            assert.ok(!server.jutsuHasFixedEffectPower([{ name }]), `server: ${name} must NOT be fixed-effect`);
        }
    });

    it('Pierce (a builder-unique damage mode, not in allTags) is still a known server tag', () => {
        assert.ok(client.bloodlineUniqueTags.includes('Pierce'));
        assert.ok(server.KNOWN_TAG_NAMES.has('Pierce'));
        assert.ok(server.CANONICAL_TAG_NAMES.includes('Pierce'));
    });
});
