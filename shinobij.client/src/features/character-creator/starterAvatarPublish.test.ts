/*
 * The default (starter) avatar must stay a static path.
 *
 * Every new player leaves the creator with one of the two starter presets — a
 * .webp that ships in the client bundle. The publish step used to swap that path
 * for the base64 copy it uploads to the shared bucket, which meant the DEFAULT
 * avatar (the one nearly everyone has) was served through /api/img + a Postgres
 * read instead of the bundled file, and the save clamp then stripped it because
 * a data URL is not an allowlisted preset. Result: initials whenever the shared-
 * image manifest was slow or failed.
 *
 * Presets are static public assets, so account creation keeps the path and does
 * not POST duplicate bytes to the supporter-gated custom-avatar endpoint.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keepsPresetPath, publishStarterAvatarForCharacter } from "./starterAvatarPublish";
import { STARTER_AVATARS } from "./characterCreatorCopy";
import { isPresetAvatar } from "../../lib/entitlements";
import type { Character } from "../../types/character";

describe("starter avatar path retention", () => {
    it("keeps every avatar the creator can actually offer", () => {
        assert.ok(STARTER_AVATARS.length > 0);
        for (const avatar of STARTER_AVATARS) {
            assert.equal(keepsPresetPath(avatar.image), true, `${avatar.id} (${avatar.image})`);
        }
    });

    // The load-bearing coupling: anything we keep as a path MUST also be
    // recognised by the entitlement allowlist, or the save clamp reverts it and
    // the default avatar is stripped all over again.
    it("only keeps paths the save clamp will accept from a non-subscriber", () => {
        for (const avatar of STARTER_AVATARS) {
            assert.equal(isPresetAvatar(avatar.image), true, `${avatar.id} (${avatar.image})`);
        }
    });

    it("does not make a pre-save shared upload for any allowlisted preset", async () => {
        for (const avatar of STARTER_AVATARS) {
            const character = { name: "Preset", avatarImage: avatar.image } as Character;
            let published = false;
            const result = await publishStarterAvatarForCharacter(character, () => { published = true; });
            assert.equal(result, character);
            assert.equal(published, false, `${avatar.id} must bypass the custom-avatar POST`);
        }
    });

    it("adopts the published copy for a custom (non-preset) source", () => {
        assert.equal(keepsPresetPath("data:image/webp;base64,AAAA"), false);
        assert.equal(keepsPresetPath("/api/img?id=avatar%3Asloth"), false);
        assert.equal(keepsPresetPath(""), false);
    });
});
