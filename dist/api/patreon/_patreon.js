"use strict";
/*
 * Patreon integration core — shared helpers for the OAuth link flow
 * (oauth-start / oauth-callback), the membership webhook (webhook.ts), and the
 * client-facing status endpoint (status.ts).
 *
 * SECURITY MODEL (see docs/auth-and-anti-cheat-patterns.md for the wider one):
 *   - The subscriber flag lives on the player's save at `character.patreon` and
 *     is SERVER-OWNED. api/save/[name].ts lists `patreon` in
 *     ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS, so a client save can never set or
 *     forge it — it is always copied from the stored record. The ONLY writer is
 *     `applyEntitlementToSave` below, driven by a signature-verified webhook or
 *     the OAuth callback (both trusted, server-side).
 *   - Patreon webhooks are authenticated by an HMAC-MD5 of the RAW request body
 *     keyed by PATREON_WEBHOOK_SECRET, sent in the `X-Patreon-Signature` header
 *     (Patreon's documented scheme). `verifyWebhookSignature` is the trust
 *     boundary; an unverified body is dropped.
 *   - The OAuth `state` is HMAC-signed and carries the in-game player name +
 *     expiry so the callback can trust WHICH account to link without a
 *     server-side session table, and a forged/late state is rejected.
 *
 * CONFIG (env, set on BOTH Railway and cPanel like SESSION_SECRET; never
 * committed): PATREON_CLIENT_ID, PATREON_CLIENT_SECRET, PATREON_WEBHOOK_SECRET,
 * PATREON_REDIRECT_URI, PATREON_CAMPAIGN_ID (optional filter),
 * PATREON_SUB_MIN_CENTS (default 1500 = the $15 tier). If unconfigured, the
 * endpoints degrade gracefully (link disabled) and nothing writes the flag.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPatreonSubscriber = exports.SUBSCRIBER_TIER = void 0;
exports.patreonClientId = patreonClientId;
exports.patreonClientSecret = patreonClientSecret;
exports.patreonWebhookSecret = patreonWebhookSecret;
exports.patreonCampaignId = patreonCampaignId;
exports.patreonRedirectUri = patreonRedirectUri;
exports.subMinCents = subMinCents;
exports.patreonConfigured = patreonConfigured;
exports.signState = signState;
exports.verifyState = verifyState;
exports.verifyWebhookSignature = verifyWebhookSignature;
exports.buildAuthorizeUrl = buildAuthorizeUrl;
exports.exchangeCodeForToken = exchangeCodeForToken;
exports.fetchIdentityMembership = fetchIdentityMembership;
exports.parseWebhookMember = parseWebhookMember;
exports.computeEntitlement = computeEntitlement;
exports.getLinkedPlayer = getLinkedPlayer;
exports.getLinkedPatreonUserId = getLinkedPatreonUserId;
exports.linkPlayer = linkPlayer;
exports.getMemberRecord = getMemberRecord;
exports.setMemberRecord = setMemberRecord;
exports.applyEntitlementToSave = applyEntitlementToSave;
exports.applyAdminSubscription = applyAdminSubscription;
exports.patreonTier = patreonTier;
const crypto_1 = require("crypto");
const _storage_js_1 = require("../_storage.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _utils_js_1 = require("../_utils.js");
const _entitlements_js_1 = require("../_entitlements.js");
Object.defineProperty(exports, "isPatreonSubscriber", { enumerable: true, get: function () { return _entitlements_js_1.isPatreonSubscriber; } });
// ─── Env accessors ────────────────────────────────────────────────────────────
function patreonClientId() { return String(process.env.PATREON_CLIENT_ID ?? '').trim(); }
function patreonClientSecret() { return String(process.env.PATREON_CLIENT_SECRET ?? '').trim(); }
function patreonWebhookSecret() { return String(process.env.PATREON_WEBHOOK_SECRET ?? '').trim(); }
function patreonCampaignId() { return String(process.env.PATREON_CAMPAIGN_ID ?? '').trim(); }
function patreonRedirectUri() { return String(process.env.PATREON_REDIRECT_URI ?? '').trim(); }
/** Cents threshold at/above which a patron counts as a subscriber. $15 = 1500. */
function subMinCents() {
    const n = Math.floor(Number(process.env.PATREON_SUB_MIN_CENTS));
    return Number.isFinite(n) && n > 0 ? n : 1500;
}
/** Link + OAuth are usable only when a client id + secret are configured. */
function patreonConfigured() {
    return !!patreonClientId() && !!patreonClientSecret();
}
/**
 * Secret used to sign the OAuth `state`. Prefers SESSION_SECRET (the canonical
 * master signing key); falls back to the Patreon client secret so linking still
 * works if SESSION_SECRET is unset. Both are server-only.
 */
function stateSecret() {
    return String(process.env.SESSION_SECRET ?? '').trim() || patreonClientSecret();
}
// ─── Constant-time string compare ─────────────────────────────────────────────
function timingSafeEqualStr(a, b) {
    const ba = Buffer.from(String(a ?? ''));
    const bb = Buffer.from(String(b ?? ''));
    if (ba.length !== bb.length) {
        // Keep timing flat-ish on a length mismatch.
        try {
            (0, crypto_1.timingSafeEqual)(ba, ba);
        }
        catch { /* zero-length */ }
        return false;
    }
    return (0, crypto_1.timingSafeEqual)(ba, bb);
}
// ─── OAuth state (anti-CSRF, carries the player name) ─────────────────────────
const STATE_TTL_MS = 15 * 60_000;
/** `<base64url(name.exp)>.<hmac>` — verifiable, self-expiring, no server table. */
function signState(playerName, ttlMs = STATE_TTL_MS) {
    const exp = Date.now() + Math.max(1, ttlMs);
    const payload = `${playerName}.${exp}`;
    const sig = (0, crypto_1.createHmac)('sha256', stateSecret()).update(payload).digest('base64url');
    return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
}
/** Returns the sanitized player name if the state is authentic and unexpired. */
function verifyState(state) {
    const parts = String(state ?? '').split('.');
    if (parts.length !== 2)
        return null;
    const [b64, sig] = parts;
    let payload;
    try {
        payload = Buffer.from(b64, 'base64url').toString('utf8');
    }
    catch {
        return null;
    }
    const expected = (0, crypto_1.createHmac)('sha256', stateSecret()).update(payload).digest('base64url');
    if (!timingSafeEqualStr(sig, expected))
        return null;
    const sep = payload.lastIndexOf('.');
    if (sep <= 0)
        return null;
    const name = payload.slice(0, sep);
    const exp = Number(payload.slice(sep + 1));
    if (!Number.isFinite(exp) || Date.now() > exp)
        return null;
    return (0, _utils_js_1.safeName)(name) || null;
}
// ─── Webhook signature (HMAC-MD5 hex of the RAW body) ─────────────────────────
function verifyWebhookSignature(rawBody, signatureHeader) {
    const secret = patreonWebhookSecret();
    if (!secret || !signatureHeader)
        return false;
    const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
    const expected = (0, crypto_1.createHmac)('md5', secret).update(buf).digest('hex');
    return timingSafeEqualStr(String(signatureHeader).trim(), expected);
}
// ─── OAuth authorize / token / identity ───────────────────────────────────────
const AUTHORIZE_URL = 'https://www.patreon.com/oauth2/authorize';
const TOKEN_URL = 'https://www.patreon.com/api/oauth2/token';
const IDENTITY_URL = 'https://www.patreon.com/api/oauth2/v2/identity';
function buildAuthorizeUrl(signedState) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: patreonClientId(),
        redirect_uri: patreonRedirectUri(),
        // identity + memberships so the callback can read the current tier.
        scope: 'identity identity[email] identity.memberships',
        state: signedState,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
}
async function exchangeCodeForToken(code) {
    if (!patreonConfigured())
        return null;
    const body = new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: patreonClientId(),
        client_secret: patreonClientSecret(),
        redirect_uri: patreonRedirectUri(),
    });
    try {
        const resp = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!resp.ok)
            return null;
        const json = await resp.json();
        return json?.access_token ? { access_token: json.access_token, refresh_token: json.refresh_token } : null;
    }
    catch {
        return null;
    }
}
function parseMemberAttributes(attributes) {
    const a = (attributes ?? {});
    return {
        patronStatus: String(a.patron_status ?? ''),
        entitledCents: Math.max(0, Math.floor(Number(a.currently_entitled_amount_cents) || 0)),
        lastChargeStatus: String(a.last_charge_status ?? ''),
    };
}
/**
 * Fetch the authenticated patron's Patreon user id + their membership of OUR
 * campaign (best/highest entitlement if PATREON_CAMPAIGN_ID is unset). Returns
 * null on any transport/parse failure so callers fail closed.
 */
async function fetchIdentityMembership(accessToken) {
    const url = new URL(IDENTITY_URL);
    url.searchParams.set('include', 'memberships,memberships.campaign');
    url.searchParams.set('fields[member]', 'patron_status,currently_entitled_amount_cents,last_charge_status');
    try {
        const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!resp.ok)
            return null;
        const json = await resp.json();
        const userId = String(json?.data?.id ?? '');
        if (!userId)
            return null;
        const included = Array.isArray(json.included) ? json.included : [];
        const wantCampaign = patreonCampaignId();
        let best = null;
        for (const row of included) {
            if (row?.type !== 'member')
                continue;
            const rel = (row.relationships ?? {});
            const campaignId = rel.campaign?.data?.id ? String(rel.campaign.data.id) : '';
            if (wantCampaign && campaignId && campaignId !== wantCampaign)
                continue;
            const info = parseMemberAttributes(row.attributes);
            if (!best || info.entitledCents > best.entitledCents)
                best = info;
        }
        return { userId, membership: best };
    }
    catch {
        return null;
    }
}
/**
 * Parse a webhook payload (members:create / members:update / members:delete).
 * The member is `data`; the Patreon user id is the `user` relationship id (the
 * same id fetchIdentityMembership returns as data.id). Returns null if the
 * payload is not a recognizable member event.
 */
function parseWebhookMember(payload) {
    const data = payload?.data;
    if (!data || typeof data !== 'object')
        return null;
    const rel = (data.relationships ?? {});
    const userId = rel.user?.data?.id ? String(rel.user.data.id) : '';
    if (!userId)
        return null;
    return { userId, membership: parseMemberAttributes(data.attributes) };
}
/** The single subscriber tier id today; extend when more tiers are added. */
exports.SUBSCRIBER_TIER = 'shinobi-supporter';
function computeEntitlement(membership) {
    const entitledCents = membership?.entitledCents ?? 0;
    const active = !!membership
        && membership.patronStatus === 'active_patron'
        && entitledCents >= subMinCents();
    return { active, tier: active ? exports.SUBSCRIBER_TIER : 'none', entitledCents };
}
// ─── Link store + member ledger ───────────────────────────────────────────────
//
// Namespaced OUTSIDE `save:*` so the mapping survives the pending pre-launch
// wipe and can re-apply the flag after reset. `patreon:link:<userId>` and its
// reverse `patreon:player:<nameLower>` bind a Patreon account to a game account;
// `patreon:member:<userId>` is the reconcilable membership ledger.
const linkKey = (userId) => `patreon:link:${userId}`;
const playerKey = (playerName) => `patreon:player:${playerName.toLowerCase()}`;
const memberKey = (userId) => `patreon:member:${userId}`;
async function getLinkedPlayer(userId) {
    const v = await _storage_js_1.kv.get(linkKey(userId));
    return typeof v === 'string' && v ? v : null;
}
async function getLinkedPatreonUserId(playerName) {
    const v = await _storage_js_1.kv.get(playerKey((0, _utils_js_1.safeName)(playerName)));
    return typeof v === 'string' && v ? v : null;
}
async function linkPlayer(userId, playerName) {
    const name = (0, _utils_js_1.safeName)(playerName);
    await _storage_js_1.kv.set(linkKey(userId), name);
    await _storage_js_1.kv.set(playerKey(name), userId);
}
async function getMemberRecord(userId) {
    return (await _storage_js_1.kv.get(memberKey(userId))) ?? null;
}
async function setMemberRecord(userId, ent, patronStatus) {
    const rec = {
        userId,
        tier: ent.tier,
        active: ent.active,
        entitledCents: ent.entitledCents,
        patronStatus,
        updatedAt: Date.now(),
    };
    await _storage_js_1.kv.set(memberKey(userId), rec);
}
// ─── Apply the flag to the player's save (the ONLY writer) ────────────────────
/**
 * Write `character.patreon` under the save lock. Idempotent: a re-delivered
 * webhook whose entitlement matches the stored flag is a no-op (no version
 * bump), so retries are cheap and safe. Returns false when the linked save
 * doesn't exist yet (unlinked / brand-new account) — the caller keeps the
 * member ledger so the flag can be reconciled on the next link/save.
 */
async function applyEntitlementToSave(playerName, userId, ent) {
    const key = `save:${(0, _utils_js_1.safeName)(playerName)}`;
    return await (0, _lock_js_1.withKvLock)(key, async () => {
        const rec = await _storage_js_1.kv.get(key);
        const char = (rec?.character ?? null);
        if (!rec || !char)
            return false;
        const now = Date.now();
        const prev = (char.patreon ?? null);
        // Skip the write when nothing meaningful changed — makes webhook
        // re-delivery a free no-op instead of a redundant version bump.
        if (prev
            && prev.userId === userId
            && prev.active === ent.active
            && prev.tier === ent.tier
            && Number(prev.entitledCents) === ent.entitledCents) {
            return true;
        }
        // Preserve the original "since" while active; clear tracking on lapse.
        const prevSince = prev && Number(prev.since) > 0 ? Number(prev.since) : 0;
        const since = ent.active ? (prevSince || now) : (prevSince || undefined);
        char.patreon = {
            userId,
            tier: ent.tier,
            active: ent.active,
            entitledCents: ent.entitledCents,
            since,
            updatedAt: now,
        };
        const record = (0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: char });
        await _storage_js_1.kv.set(key, (0, _utils_js_1.mergePreservingImages)(record, rec));
        return true;
    }, { failClosed: true });
}
/**
 * Full-admin comp: activate (or revoke) the Shinobi Supporter perks on a
 * player's save regardless of payment. An activation auto-EXPIRES after `days`
 * (default 30) via character.patreon.expiresAt — isPatreonSubscriber treats a
 * lapsed comp as inactive, so no cron is needed. Writes the server-owned flag
 * under the save lock (the same field a client save can never forge). Returns
 * null when the player has no server save.
 */
async function applyAdminSubscription(playerName, opts) {
    const key = `save:${(0, _utils_js_1.safeName)(playerName)}`;
    return await (0, _lock_js_1.withKvLock)(key, async () => {
        const rec = await _storage_js_1.kv.get(key);
        const char = (rec?.character ?? null);
        if (!rec || !char)
            return null;
        const now = Date.now();
        const prev = (char.patreon ?? null);
        const prevUserId = typeof prev?.userId === 'string' ? prev.userId : '';
        const prevSince = prev && Number(prev.since) > 0 ? Number(prev.since) : 0;
        let flag;
        if (opts.active) {
            const days = Math.max(1, Math.floor(opts.days ?? 30));
            flag = {
                userId: prevUserId,
                tier: exports.SUBSCRIBER_TIER,
                active: true,
                entitledCents: Number(prev?.entitledCents ?? 0),
                since: prevSince || now,
                updatedAt: now,
                expiresAt: now + days * 86_400_000,
                source: 'admin',
            };
        }
        else {
            flag = {
                userId: prevUserId,
                tier: 'none',
                active: false,
                entitledCents: Number(prev?.entitledCents ?? 0),
                since: prevSince || undefined,
                updatedAt: now,
                source: 'admin',
            };
        }
        char.patreon = flag;
        const record = (0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: char });
        await _storage_js_1.kv.set(key, (0, _utils_js_1.mergePreservingImages)(record, rec));
        return { active: opts.active, tier: String(flag.tier), expiresAt: flag.expiresAt ?? null };
    }, { failClosed: true });
}
function patreonTier(character) {
    if (!(0, _entitlements_js_1.isPatreonSubscriber)(character))
        return null;
    const tier = character.patreon?.tier;
    return String(tier ?? exports.SUBSCRIBER_TIER);
}
