"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumeSingleUseToken = consumeSingleUseToken;
/**
 * Consume a random single-use token whose value must be read before use.
 *
 * The delete rowcount is the actual consume gate: two racing callers can both
 * read the token, but only the caller whose delete removes a row may proceed.
 */
async function consumeSingleUseToken(store, key) {
    const token = await store.get(key);
    if (!token)
        return null;
    const removed = await store.del(key);
    return removed > 0 ? token : null;
}
