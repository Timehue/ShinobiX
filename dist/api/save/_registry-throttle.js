"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldWriteRegistry = shouldWriteRegistry;
const _public_index_js_1 = require("../player/_public-index.js");
function shouldWriteRegistry(opts) {
    const { isClanSave, existingChar, next, prevRegistryAt, now, refreshMs } = opts;
    // Clan saves and brand-new players always index so the registry is never
    // missing an entry (the roster/bloodline/injured readers derive their key
    // list from it). Throttling only ever skips a REFRESH of an existing entry.
    if (isClanSave)
        return true;
    if (!existingChar)
        return true;
    if ((0, _public_index_js_1.publicPlayerIndexChanged)(existingChar, next))
        return true;
    // Nothing roster-visible changed — only refresh lastSeen if it would drift.
    return now - prevRegistryAt > refreshMs;
}
