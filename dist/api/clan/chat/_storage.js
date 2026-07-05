"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLAN_CHAT_TTL_SEC = exports.CLAN_CHAT_MAX_MESSAGES = exports.CLAN_CHAT_KEY_PREFIX = void 0;
exports.clanChatKey = clanChatKey;
exports.cleanChatText = cleanChatText;
exports.appendChatMessage = appendChatMessage;
exports.messagesSince = messagesSince;
/*
 * Clan chat — pure storage helpers (IO-free, unit-testable).
 *
 * Cost-conscious by design: chat lives in its OWN capped KV key
 * (`clan-chat:<slug>`), NOT on the polled clan save blob, and is text-only
 * (never images — base64-in-JSON polling is this project's dominant cost).
 * The buffer is a fixed-size ring (CLAN_CHAT_MAX_MESSAGES); the GET endpoint
 * serves a `since`-cursor slice so an idle poll returns an empty list.
 */
const _text_moderation_js_1 = require("../../_text-moderation.js");
exports.CLAN_CHAT_KEY_PREFIX = 'clan-chat:';
exports.CLAN_CHAT_MAX_MESSAGES = 50;
// Chat keys expire if a clan goes quiet, so dead clans don't hold storage.
// The TTL is refreshed on every send, so an active clan never loses history.
exports.CLAN_CHAT_TTL_SEC = 30 * 24 * 60 * 60;
function clanChatKey(slug) {
    return `${exports.CLAN_CHAT_KEY_PREFIX}${slug}`;
}
/**
 * Sanitize an incoming chat message. sanitizeUserText trims, caps length at
 * TEXT_LIMITS.chatMessage, and MASKS blocked (slur/hate) terms — matching how
 * the rest of the game moderates user text, so a slur is censored rather than
 * rejected. Returns null only when nothing is left after trimming.
 */
function cleanChatText(input) {
    return (0, _text_moderation_js_1.sanitizeUserText)(input, _text_moderation_js_1.TEXT_LIMITS.chatMessage) || null;
}
/** Append a message to the capped ring buffer, dropping the oldest past the cap. */
function appendChatMessage(existing, msg) {
    const buf = Array.isArray(existing) ? existing.slice() : [];
    buf.push(msg);
    return buf.length > exports.CLAN_CHAT_MAX_MESSAGES ? buf.slice(buf.length - exports.CLAN_CHAT_MAX_MESSAGES) : buf;
}
/** Messages strictly newer than `since` (ms). since<=0 returns the whole buffer. */
function messagesSince(buf, since) {
    const all = Array.isArray(buf) ? buf : [];
    if (!Number.isFinite(since) || since <= 0)
        return all;
    return all.filter(m => Number(m.ts) > since);
}
