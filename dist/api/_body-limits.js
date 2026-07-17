"use strict";
// Route-specific request-body size classification for the Express server
// (server.ts). The 50 MB JSON parser is granted ONLY to the exact routes that
// carry large image / import payloads — NOT to the whole /admin/* tree, where an
// unauthenticated caller could otherwise force a 50 MB buffer + synchronous JSON
// parse BEFORE the handler's auth check runs. Player saves get a dedicated 1 MB
// parser so an oversized save is rejected at the parser boundary (matching the
// save handler's own 1 MB cap) instead of being buffered/parsed under the larger
// default first.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAVE_BODY_RE = exports.BIG_BODY_RE = void 0;
exports.classifyBodyLimit = classifyBodyLimit;
// Large-body routes:
//   • images / img / generate-image — image upload + generation blobs.
//   • kv-proxy — the cPanel KV proxy relay (multi-MB image/save blobs).
//   • admin/bloodline-review — the ONE admin surface that receives data:image
//     content; item-review + save-snapshot are included for content-review /
//     restore parity. Every OTHER /admin/* route takes a small body and no
//     longer gets the 50 MB parser (closes the pre-auth 50 MB parse surface).
exports.BIG_BODY_RE = /(?:^|\/)(?:images|img|generate-image|kv-proxy)(?:\/|$)|\/admin\/(?:bloodline-review|item-review|save-snapshot)(?:\/|$)/;
// Player-save routes (bare and /api-prefixed). `save-snapshot` is deliberately
// NOT matched (it ends in `-snapshot`, not `save/…`), and it is already handled
// as a big-body admin route above. Capped at 1 MB: the save handler already
// rejects bodies over 1 MB, so nothing legitimate exceeds it — enforcing it here
// stops the oversized body before it is buffered/parsed.
exports.SAVE_BODY_RE = /(?:^|\/)save(?:\/|$)/;
/** Which JSON body-size limit a request path should be parsed under. */
function classifyBodyLimit(path) {
    if (exports.BIG_BODY_RE.test(path))
        return 'big';
    if (exports.SAVE_BODY_RE.test(path))
        return 'save';
    return 'default';
}
