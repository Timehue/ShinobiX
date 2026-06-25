"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const images_js_1 = require("./images.js");
// Pure validation logic for the shared-image upload endpoint (audit #23). No KV,
// no network — covers the internal-host / SSRF guard and the data-URL allowlist.
(0, node_test_1.describe)('isUnsafeImageUrlHost (internal-target guard)', () => {
    (0, node_test_1.it)('flags localhost and internal / mDNS TLDs', () => {
        for (const h of ['localhost', 'foo.localhost', 'box.local', 'svc.internal', 'host.lan', 'nas.home', 'app.corp', 'wiki.intranet']) {
            node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)(h), true, h);
        }
    });
    (0, node_test_1.it)('flags bare single-label hosts', () => {
        node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)('router'), true);
        node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)('intranet'), true);
    });
    (0, node_test_1.it)('flags private / loopback / link-local / CGNAT IPv4', () => {
        for (const h of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '100.64.0.1', '0.0.0.0']) {
            node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)(h), true, h);
        }
    });
    (0, node_test_1.it)('allows public IPv4 (incl. 172.x / 100.x outside the private ranges)', () => {
        for (const h of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1']) {
            node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)(h), false, h);
        }
    });
    (0, node_test_1.it)('flags numeric / hex IPv4 obfuscation', () => {
        node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)('2130706433'), true); // 127.0.0.1 decimal
        node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)('0x7f000001'), true); // 127.0.0.1 hex
    });
    (0, node_test_1.it)('flags IPv6 loopback / link-local / unique-local (with or without brackets)', () => {
        for (const h of ['::1', '[::1]', 'fe80::1', 'fc00::1', 'fd12:3456::1']) {
            node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)(h), true, h);
        }
    });
    (0, node_test_1.it)('allows global IPv6 and public domains (incl. ones that start with fc/fd)', () => {
        node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)('2606:4700::6810:85e5'), false);
        node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)('cdn.example.com'), false);
        node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)('fc-barcelona.com'), false);
        node_assert_1.strict.equal((0, images_js_1.isUnsafeImageUrlHost)('fd-example.net'), false);
    });
});
(0, node_test_1.describe)('isValidImageString', () => {
    (0, node_test_1.it)('accepts raster data URLs', () => {
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('data:image/png;base64,AAAA'), true);
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('data:image/jpeg;base64,AAAA'), true);
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('data:image/webp;base64,AAAA'), true);
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('data:image/gif;base64,AAAA'), true);
    });
    (0, node_test_1.it)('rejects SVG and non-image data URLs', () => {
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('data:image/svg+xml;base64,AAAA'), false);
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('data:text/html;base64,AAAA'), false);
    });
    (0, node_test_1.it)('accepts public http(s) image URLs', () => {
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('https://cdn.example.com/a.png'), true);
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('http://images.example.org/p.jpg'), true);
    });
    (0, node_test_1.it)('rejects internal / loopback / metadata http(s) URLs', () => {
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('http://localhost/a.png'), false);
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('http://127.0.0.1:9000/a.png'), false);
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('http://169.254.169.254/latest/meta-data/'), false);
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('http://[::1]/a.png'), false);
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('http://192.168.0.10/a.png'), false);
    });
    (0, node_test_1.it)('rejects malformed URLs and oversized strings', () => {
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('https://'), false);
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('ftp://example.com/a.png'), false);
        node_assert_1.strict.equal((0, images_js_1.isValidImageString)('x'.repeat(3_000_001)), false);
    });
});
(0, node_test_1.describe)('base64DecodedByteLength', () => {
    (0, node_test_1.it)('computes decoded size from the base64 part (handles padding)', () => {
        node_assert_1.strict.equal((0, images_js_1.base64DecodedByteLength)('data:image/png;base64,AAAA'), 3); // no pad
        node_assert_1.strict.equal((0, images_js_1.base64DecodedByteLength)('data:image/png;base64,AAA='), 2); // 1 pad
        node_assert_1.strict.equal((0, images_js_1.base64DecodedByteLength)('data:image/png;base64,AA=='), 1); // 2 pad
        node_assert_1.strict.equal((0, images_js_1.base64DecodedByteLength)(''), 0);
    });
});
(0, node_test_1.describe)('avatarImageReject (avatar hardening, #15)', () => {
    (0, node_test_1.it)('accepts a small raster data-URL avatar (incl. animated gif/webp)', () => {
        node_assert_1.strict.equal((0, images_js_1.avatarImageReject)('data:image/png;base64,' + 'A'.repeat(100)), null);
        node_assert_1.strict.equal((0, images_js_1.avatarImageReject)('data:image/gif;base64,' + 'A'.repeat(100)), null);
        node_assert_1.strict.equal((0, images_js_1.avatarImageReject)('data:image/webp;base64,' + 'A'.repeat(100)), null);
    });
    (0, node_test_1.it)('rejects a remote http(s) URL avatar — must be inline', () => {
        const r = (0, images_js_1.avatarImageReject)('https://cdn.example.com/a.png');
        node_assert_1.strict.ok(r && /data url|uploaded image/i.test(r), r ?? 'expected rejection');
    });
    (0, node_test_1.it)('rejects SVG avatars (XSS vector)', () => {
        node_assert_1.strict.ok((0, images_js_1.avatarImageReject)('data:image/svg+xml;base64,AAAA'));
    });
    (0, node_test_1.it)('rejects an avatar over the 2 MB decoded cap', () => {
        // 'A'.repeat(3,000,000) base64 → ~2.25 MB decoded, over the 2 MB cap.
        const big = 'data:image/png;base64,' + 'A'.repeat(3_000_000);
        const r = (0, images_js_1.avatarImageReject)(big);
        node_assert_1.strict.ok(r && /2 MB/i.test(r), r ?? 'expected size rejection');
    });
});
(0, node_test_1.describe)('ownershipReject — player-forged named-item image carve-out', () => {
    const player = { admin: false, name: 'rill' };
    const admin = { admin: true };
    (0, node_test_1.it)('lets a non-admin player image their own forged named weapon/armor', () => {
        node_assert_1.strict.equal((0, images_js_1.ownershipReject)('item:named-weapon-abc123', player), null);
        node_assert_1.strict.equal((0, images_js_1.ownershipReject)('item:named-armor-xyz789', player), null);
    });
    (0, node_test_1.it)('still blocks non-admins from writing generic catalog item images', () => {
        const r = (0, images_js_1.ownershipReject)('item:wooden-katana', player);
        node_assert_1.strict.ok(r && r.status === 403, 'expected 403 for catalog item');
    });
    (0, node_test_1.it)('still blocks other admin-only prefixes for non-admins', () => {
        for (const id of ['jutsu:fireball', 'card:tile-1', 'event:boss', 'bloodline:x']) {
            const r = (0, images_js_1.ownershipReject)(id, player);
            node_assert_1.strict.ok(r && r.status === 403, `expected 403 for ${id}`);
        }
    });
    (0, node_test_1.it)('does not treat a lookalike named- prefix on another category as an item', () => {
        // The carve-out is scoped to the 'item' prefix only.
        const r = (0, images_js_1.ownershipReject)('jutsu:named-weapon-spoof', player);
        node_assert_1.strict.ok(r && r.status === 403, 'expected 403 — carve-out is item-only');
    });
    (0, node_test_1.it)('admins may write anything', () => {
        node_assert_1.strict.equal((0, images_js_1.ownershipReject)('item:wooden-katana', admin), null);
        node_assert_1.strict.equal((0, images_js_1.ownershipReject)('jutsu:fireball', admin), null);
    });
});
(0, node_test_1.describe)('ownershipReject — player bloodline + jutsu image carve-out', () => {
    const player = { admin: false, name: 'rill' };
    const uuid = 'b2e291f6-5b58-4bf3-a037-a983f716b121';
    (0, node_test_1.it)('lets a non-admin player image their own custom bloodline (random UUID id)', () => {
        node_assert_1.strict.equal((0, images_js_1.ownershipReject)(`bloodline:${uuid}`, player), null);
    });
    (0, node_test_1.it)('lets a non-admin player image their own bloodline jutsus (random UUID ids)', () => {
        node_assert_1.strict.equal((0, images_js_1.ownershipReject)(`jutsu:${uuid}`, player), null);
    });
    (0, node_test_1.it)('still blocks non-admins from the readable admin CATALOG bloodline/jutsu ids', () => {
        for (const id of ['bloodline:starter-bloodline-ashen-eyes', 'jutsu:starter-universal-blitz', 'bloodline:x', 'jutsu:fireball']) {
            const r = (0, images_js_1.ownershipReject)(id, player);
            node_assert_1.strict.ok(r && r.status === 403, `expected 403 for ${id}`);
        }
    });
    (0, node_test_1.it)('does not let the UUID carve-out leak to other admin-only prefixes', () => {
        for (const prefix of ['card', 'event', 'ai', 'shrine', 'landmark', 'leader']) {
            const r = (0, images_js_1.ownershipReject)(`${prefix}:${uuid}`, player);
            node_assert_1.strict.ok(r && r.status === 403, `expected 403 for ${prefix}:<uuid>`);
        }
    });
});
(0, node_test_1.describe)('categoryFromId — leader category (#16)', () => {
    (0, node_test_1.it)('routes leader:* to its own category instead of misc', () => {
        node_assert_1.strict.equal((0, images_js_1.categoryFromId)('leader:konoha:kage'), 'leader');
        node_assert_1.strict.equal((0, images_js_1.categoryFromId)('leader:suna:elder:1'), 'leader');
    });
    (0, node_test_1.it)('routes avatar:* and unknown prefixes correctly', () => {
        node_assert_1.strict.equal((0, images_js_1.categoryFromId)('avatar:rill'), 'avatar');
        node_assert_1.strict.equal((0, images_js_1.categoryFromId)('whatever:foo'), 'misc');
    });
});
