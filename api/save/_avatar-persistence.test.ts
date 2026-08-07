/*
 * Regression: a non-subscriber's avatar must survive the save.
 *
 * The Patreon perk clamp reverts a NEW custom avatar for non-subscribers. It
 * compared the incoming value against an exact-string preset allowlist, but the
 * client never holds a preset path by the time it saves — once the avatar is in
 * the shared image bucket, loadCategory('avatar') hydrates
 * `character.avatarImage` with the per-image reference `/api/img?id=avatar:<name>`.
 * That pointer matched nothing, so it read as a new custom upload and was
 * DELETED on every write. No non-subscriber's save ever carried an avatar, so
 * their own left rail / mobile HUD / sector marker fell back to initials on
 * every login and stayed there for the whole session whenever the shared-image
 * manifest fetch was slow or failed. (Other players were unaffected — they
 * resolve the portrait from the shared bucket, not from this save.)
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeCharacterSave } from './[name].js';
import { isPresetAvatar, isOwnAvatarReference } from '../_entitlements.js';

const CUSTOM = 'data:image/webp;base64,' + 'A'.repeat(200);
const OWN_REF = '/api/img?id=avatar%3Asloth';

const charOf = (over: Record<string, unknown> = {}) => ({
    name: 'Sloth', village: 'Leaf', specialty: 'Ninjutsu', level: 1,
    rankTitle: 'Academy Student', ...over,
});
const avatarAfterSave = (
    incoming: Record<string, unknown>,
    stored: Record<string, unknown> | null,
) => (sanitizeCharacterSave(
    { character: incoming },
    stored ? { character: stored } : null,
).character as Record<string, unknown>).avatarImage;

describe('isPresetAvatar', () => {
    it('matches a preset path', () => {
        assert.equal(isPresetAvatar('/starter-avatar-one.webp'), true);
    });
    it('matches a preset carrying the creator cache-buster', () => {
        // STARTER_AVATARS ships "/starter-avatar-one.webp?v=2".
        assert.equal(isPresetAvatar('/starter-avatar-one.webp?v=2'), true);
    });
    it('rejects a custom upload', () => {
        assert.equal(isPresetAvatar(CUSTOM), false);
    });
});

describe('isOwnAvatarReference', () => {
    it('accepts the hydrated reference to the player\'s own shared image', () => {
        assert.equal(isOwnAvatarReference(OWN_REF, 'Sloth'), true);
        assert.equal(isOwnAvatarReference('/api/img?id=avatar:sloth', 'SLOTH'), true);
    });
    it('rejects a reference to SOMEONE ELSE\'s avatar', () => {
        assert.equal(isOwnAvatarReference('/api/img?id=avatar%3Arill', 'Sloth'), false);
    });
    it('rejects references to other image categories', () => {
        assert.equal(isOwnAvatarReference('/api/img?id=ai%3Araiko', 'Sloth'), false);
        assert.equal(isOwnAvatarReference('/api/img?id=item%3Asloth', 'Sloth'), false);
    });
    it('rejects non-reference values', () => {
        assert.equal(isOwnAvatarReference(CUSTOM, 'Sloth'), false);
        assert.equal(isOwnAvatarReference('https://evil.example/x.png', 'Sloth'), false);
        assert.equal(isOwnAvatarReference(OWN_REF, ''), false);
    });
});

describe('non-subscriber avatar persistence', () => {
    it('keeps the hydrated own-avatar reference when nothing is stored yet', () => {
        // The steady state that was broken: the save holds no avatar, the client
        // hydrates the reference from the manifest and writes it back.
        assert.equal(avatarAfterSave(charOf({ avatarImage: OWN_REF }), charOf()), OWN_REF);
    });

    it('keeps the hydrated own-avatar reference on a first save', () => {
        assert.equal(avatarAfterSave(charOf({ avatarImage: OWN_REF }), null), OWN_REF);
    });

    it('keeps a preset avatar', () => {
        assert.equal(
            avatarAfterSave(charOf({ avatarImage: '/starter-avatar-two.webp?v=2' }), charOf()),
            '/starter-avatar-two.webp?v=2',
        );
    });

    it('keeps the DEFAULT avatar on a brand-new account\'s first save', () => {
        // The whole point: a new player leaves the creator holding
        // "/starter-avatar-one.webp?v=2" and their very first save must retain
        // it, so the portrait paints from the bundled file on every later login
        // without touching /api/img at all.
        assert.equal(
            avatarAfterSave(charOf({ avatarImage: '/starter-avatar-one.webp?v=2' }), null),
            '/starter-avatar-one.webp?v=2',
        );
    });

    it('still reverts a NEW custom upload to the stored value', () => {
        assert.equal(avatarAfterSave(charOf({ avatarImage: CUSTOM }), charOf({ avatarImage: OWN_REF })), OWN_REF);
    });

    it('still refuses to adopt a custom upload when nothing is stored', () => {
        assert.equal(avatarAfterSave(charOf({ avatarImage: CUSTOM }), charOf()), undefined);
    });

    it('still refuses a reference to another player\'s avatar', () => {
        assert.equal(avatarAfterSave(charOf({ avatarImage: '/api/img?id=avatar%3Arill' }), charOf()), undefined);
    });
});

describe('subscriber avatar', () => {
    const subscriber = (over: Record<string, unknown> = {}) =>
        charOf({ patreon: { active: true, tier: 'shinobi-supporter' }, ...over });

    it('accepts a new custom upload', () => {
        assert.equal(avatarAfterSave(charOf({ avatarImage: CUSTOM }), subscriber()), CUSTOM);
    });
});
