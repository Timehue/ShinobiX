import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVillageLeadershipImages } from "./village-leadership.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

test("village leadership NPCs have default portrait images attached", () => {
    const images = normalizeVillageLeadershipImages();
    const expected = {
        "Stormveil Village": {
            kage: "/portraits/cinematic/storywide/kage-raiko-veyr.webp",
            elders: [
                "/portraits/cinematic/storywide/elder-vanta.webp",
                "/portraits/cinematic/storywide/mira-volt-neutral.webp",
                "/portraits/cinematic/storywide/tempest-guard-captain.webp",
            ],
        },
        "Ashen Leaf Village": {
            kage: "/portraits/cinematic/storywide/kage-hoshina-enju-canon.webp",
            elders: [
                "/portraits/cinematic/elder-mori.webp",
                "/portraits/cinematic/toma-reed.webp",
                "/portraits/cinematic/registry-duty-clerk.webp",
            ],
        },
        "Frostfang Village": {
            kage: "/portraits/cinematic/storywide/kage-kael-whitefang.webp",
            elders: [
                "/portraits/cinematic/storywide/elder-sova-canon.webp",
                "/portraits/cinematic/storywide/captain-yura.webp",
                "/portraits/cinematic/storywide/seal-keeper-vess-clean-alpha-v1.webp",
            ],
        },
        "Moonshadow Village": {
            kage: "/portraits/cinematic/storywide/kage-sable-nocturne-readable.webp",
            elders: [
                "/portraits/cinematic/storywide/shade-master-iro.webp",
                "/portraits/cinematic/storywide/nyx-neutral.webp",
                "/portraits/veiled-hand-grandmaster.webp",
            ],
        },
    } as const;

    for (const [village, expectedImages] of Object.entries(expected)) {
        assert.equal(images[village]?.kage, expectedImages.kage);
        assert.deepEqual(images[village]?.elders, expectedImages.elders);
        for (const portrait of [expectedImages.kage, ...expectedImages.elders]) {
            assert.equal(existsSync(path.join(PUBLIC_DIR, portrait.replace(/^\//, ""))), true, portrait);
        }
    }
});

test("legacy generated leadership paths migrate to story portraits without replacing custom images", () => {
    const images = normalizeVillageLeadershipImages({
        "Stormveil Village": {
            kage: "/portraits/kage-raiko-veyr.webp",
            elders: [
                "/portraits/elder-vanta.webp",
                "/custom/mira.webp",
                "/portraits/tempest-guard-captain.webp",
            ],
        },
    });

    assert.equal(images["Stormveil Village"]?.kage, "/portraits/cinematic/storywide/kage-raiko-veyr.webp");
    assert.deepEqual(images["Stormveil Village"]?.elders, [
        "/portraits/cinematic/storywide/elder-vanta.webp",
        "/custom/mira.webp",
        "/portraits/cinematic/storywide/tempest-guard-captain.webp",
    ]);
});
