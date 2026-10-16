import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { readKvProjection } from '../_storage-projection.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { getActiveSilence } from '../admin/moderation.js';
import { withKvLock } from '../_lock.js';
import { VILLAGE_CHAT_TTL_SECONDS, villageChatKey } from './_chat-key.js';
import { isCleanText, sanitizeUserText, TEXT_LIMITS, hasReservedTitleTerm } from '../_text-moderation.js';
import { LEGACY_BY_ID } from '../_legacy-defs.js';
import { legacyEnabled } from '../_legacy-track.js';
import { blockedPlayersFor } from '../player/_blocks.js';
import { rejectUnclaimedGuest } from '../_guest-gate.js';
import { socialSurfacesLocked } from '../_guest-gate.js';
import { kickVillageChat } from '../_realtime/notify.js';
import { notifyTavernMentions } from './_tavern-mentions.js';

// A quoted reference to the message being replied to. Display-only — just the
// original author + a short snippet so the client can render a quote block.
type ReplyRef = {
    author: string;
    text: string;
};

type ChatMessage = {
    author: string;
    text: string;
    ts: number;
    rank?: string;
    customTitle?: string;
    customTitleStyle?: string;
    customTitleIcon?: string;
    /** Legacy prestige chip: derived server-side from the author's save
     *  (character.legacy is server-owned/sanitizer-reinjected — unspoofable). */
    legacyStage?: number;
    level?: number;
    replyTo?: ReplyRef;
    // Server-authored lines only (World Herald announcements from
    // api/_announce.ts). Never settable via this POST — newMsg below is
    // constructed from derived fields, so players can't forge the flag.
    system?: boolean;
};

// Max length of the quoted snippet we persist for a reply. Short — it's a
// preview, not the full message; the client ellipsizes anything longer.
const REPLY_SNIPPET_LIMIT = 140;

const MAX_MESSAGES = 30; // hold the most recent 30 messages; the oldest drops as new ones arrive (count-based, no age expiry)
const KV_TTL_SECONDS = VILLAGE_CHAT_TTL_SECONDS; // the one TTL every writer of the key must use — see _chat-key.ts
const chatKey = villageChatKey;

export function sameVillage(storedVillage: unknown, requestedVillage: unknown): boolean {
    return typeof storedVillage === 'string'
        && typeof requestedVillage === 'string'
        && storedVillage.trim().toLowerCase() === requestedVillage.trim().toLowerCase();
}

// Every subscribed member re-reads the transcript after each new line, so this
// gate runs once per member per message. It needs one string of the save, so it
// reads that projection, not the whole row (avatar, inventory, jutsu, pets).
async function memberCharacter(player: string, village: string): Promise<boolean> {
    const [row] = await readKvProjection(kv, [`save:${player}`], { village: ['character', 'village'] });
    return sameVillage(row?.village, village);
}

/**
 * Whether this player may hear the tavern's socket hints: the same two gates
 * the GET applies to a player (membership, then the guest lock), so the socket
 * never reaches anyone the transcript itself would refuse. The hint carries no
 * text either way; this only keeps outsiders from timing a village's talk.
 */
export async function villageChatWatchable(player: string, village: string): Promise<boolean> {
    if (!await memberCharacter(player, village)) return false;
    return !await socialSurfacesLocked(player);
}

// The transcript as one reader may see it: lines from players they block are
// dropped, World Herald (system) lines always stay, and admins read it whole.
// Both GET and the POST reply go through this — the client replaces its list
// with either body, so a POST that skipped it re-showed blocked authors.
// Returns the filter rather than applying it so POST can read the block list
// BEFORE it writes: a failed read then refuses the post outright, instead of
// answering 500 for a line already stored and inviting a duplicate retry.
async function transcriptFilterFor(
    identity: { admin: true } | { admin: false; name: string },
): Promise<(messages: ChatMessage[]) => ChatMessage[]> {
    if (identity.admin) return (messages) => messages;
    const blocked = new Set(await blockedPlayersFor(identity.name));
    return (messages) => messages.filter((message) => message.system || !blocked.has(safeName(message.author)));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const village = typeof req.query.village === 'string' ? req.query.village.trim() : '';
    if (!village) return res.status(400).json({ error: 'Missing village.' });

    const key = chatKey(village);

    if (req.method === 'GET') {
        // Auth gate: village chat used to be scrapeable anonymously (just
        // guess the village name from the hardcoded client list). Logged-in
        // players only. Server-side reads are unaffected because they go
        // through the service-role key, not this endpoint.
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        // Start the two plain reads now so they overlap the access checks
        // below. Nothing is answered from them until those checks pass, and a
        // refused reader's results (or failures) are simply dropped.
        const transcriptRead = kv.get<ChatMessage[]>(key);
        const filterRead = transcriptFilterFor(identity);
        transcriptRead.catch(() => undefined);
        filterRead.catch(() => undefined);
        if (!identity.admin && !await memberCharacter(identity.name, village)) {
            return res.status(403).json({ error: 'You can only read your own village chat.' });
        }
        // The tavern is shut to unclaimed guests, reading included — it is a
        // village room, not a feed, and a locked room shows no transcript.
        if (await rejectUnclaimedGuest(res, identity)) return;
        const allMessages = await transcriptRead ?? [];
        const messages = (await filterRead)(allMessages);
        res.setHeader('X-Message-Count', String(messages.length));
        // X-Last-Ts too: once the log sits at MAX_MESSAGES, every append keeps
        // the count at 30, so a count-only skip check would never show new
        // lines (World Herald broadcasts made this visible). The client skips
        // re-parsing only when count AND newest-ts are both unchanged.
        res.setHeader('X-Last-Ts', String(messages.length ? messages[messages.length - 1].ts : 0));
        // Expose both so cross-origin clients can read them (the client uses
        // them to skip re-parsing the body when nothing changed).
        // Re-listing x-player-token-refresh: this overwrites the exposure list
        // cors() set, and dropping it here would blind the client's sliding
        // session refresh on chat polls.
        res.setHeader('Access-Control-Expose-Headers', 'X-Message-Count, X-Last-Ts, x-player-token-refresh');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(messages);
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { author, text, replyTo } = body as {
                author?: string;
                text?: string;
                replyTo?: { author?: unknown; text?: unknown };
            };
            if (!author || !text) return res.status(400).json({ error: 'Missing author or text.' });

            // Authenticate the author so trolls can't impersonate the Kage
            // (or anyone else) in village chat.
            const identity = await authedPlayerOrAdmin(req, author);
            if (!identity) return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== safeName(author)) {
                return res.status(403).json({ error: 'Cannot post as another player.' });
            }
            // Cap chat posts at 20/min per VERIFIED player — keeps the KV-lock
            // R-M-W from being a DOS vector while leaving room for fast banter
            // (matches the PvP chat ceiling). After auth on purpose: per IP it was
            // shared by a household; a pre-auth name key could be spent by anyone.
            if (!(await enforceRateLimitKv(req, res, 'village-chat-post', 20, 60_000, identity.admin ? null : identity.name))) return;
            if (!identity.admin && !await memberCharacter(identity.name, village)) {
                return res.status(403).json({ error: 'You can only post in your own village chat.' });
            }
            if (await rejectUnclaimedGuest(res, identity)) return;

            // Silenced players can read but not post. Admin bypasses.
            if (!identity.admin) {
                const sil = await getActiveSilence(identity.name);
                if (sil) {
                    return res.status(403).json({
                        error: 'You are silenced.',
                        silence: { until: sil.until, reason: sil.reason },
                    });
                }
            }

            // Derive rank/customTitle/level from the authed player's save so they
            // can't be spoofed via the request body (no posing as "Kage" etc.).
            let derivedRank: string | undefined;
            let derivedCustomTitle: string | undefined;
            let derivedTitleStyle: string | undefined;
            let derivedTitleIcon: string | undefined;
            let derivedLegacyStage: number | undefined;
            let derivedLevel: number | undefined;
            if (!identity.admin) {
                try {
                    const save = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                    const char = (save?.character ?? null) as Record<string, unknown> | null;
                    if (char) {
                        // `rankTitle` is the display rank ("Genin"/"Jonin"/…). The
                        // character has no plain `rank` field, so the old
                        // `char.rank` read was always undefined and the tavern
                        // rank chip never showed for offline authors.
                        if (typeof char.rankTitle === 'string') derivedRank = char.rankTitle;
                        // Mirror the presence-layer defense (presence-input.ts):
                        // the tavern chip shows customTitle to every reader, so
                        // blank any authority-impersonation title ("Admin"/"Kage"/
                        // "System"/…). The save-time reserved-term gate is
                        // flag-gated (legacyEnabled), so a title planted while it
                        // was off must not ride into chat as a fake staff badge.
                        if (typeof char.customTitle === 'string' && char.customTitle) {
                            const cleanedTitle = sanitizeUserText(char.customTitle, TEXT_LIMITS.customTitle);
                            if (cleanedTitle && !hasReservedTitleTerm(cleanedTitle)) derivedCustomTitle = cleanedTitle;
                        }
                        // Paid title cosmetics ride along (save-sanitizer
                        // allowlisted, same trust as customTitle itself).
                        if (typeof char.customTitleStyle === 'string' && char.customTitleStyle) derivedTitleStyle = char.customTitleStyle;
                        if (typeof char.customTitleIcon === 'string' && char.customTitleIcon) derivedTitleIcon = char.customTitleIcon;
                        // Legacy prestige (character.legacy is server-owned).
                        // Flag-gated: a rollback freezes prestige chips on NEW
                        // messages too (final-gate finding).
                        if (legacyEnabled()) {
                            const lg = char.legacy as { legacyId?: unknown; stage?: unknown } | null;
                            const lgDef = lg && typeof lg.legacyId === 'string' ? LEGACY_BY_ID.get(lg.legacyId) : undefined;
                            const lgStage = Number(lg?.stage);
                            if (lgDef && Number.isInteger(lgStage) && lgStage >= 1 && lgStage <= 5) {
                                derivedLegacyStage = lgStage;
                            }
                        }
                        if (typeof char.level === 'number') derivedLevel = char.level;
                    }
                } catch {
                    // Best effort — fall through with no derived fields.
                }
            }

            // Moderate + length-cap before persisting. Profanity is masked
            // with asterisks; PII patterns are redacted. Admins bypass so
            // they can still send command-style messages with URLs.
            if (!identity.admin && !isCleanText(text)) return res.status(400).json({ error: 'Message contains blocked content.' });
            const safeText = identity.admin ? text.slice(0, TEXT_LIMITS.chatMessage) : sanitizeUserText(text, TEXT_LIMITS.chatMessage);
            if (!safeText) return res.status(400).json({ error: 'Empty message after moderation.' });

            // Optional reply quote. Display-only and not security-sensitive, but
            // run the snippet through the same moderation as any user text so a
            // reply can't smuggle profanity/PII past the filter or bloat KV.
            let replyRef: ReplyRef | undefined;
            if (replyTo && typeof replyTo === 'object') {
                const rAuthor = sanitizeUserText(replyTo.author, TEXT_LIMITS.customTitle);
                const rText = sanitizeUserText(replyTo.text, REPLY_SNIPPET_LIMIT);
                if (rAuthor && rText) replyRef = { author: rAuthor, text: rText };
            }

            const newMsg: ChatMessage = {
                author,
                text: safeText,
                ts: Date.now(),
                ...(derivedRank        ? { rank: derivedRank }              : {}),
                ...(derivedCustomTitle ? { customTitle: derivedCustomTitle } : {}),
                ...(derivedTitleStyle  ? { customTitleStyle: derivedTitleStyle } : {}),
                ...(derivedTitleIcon   ? { customTitleIcon: derivedTitleIcon } : {}),
                ...(derivedLegacyStage != null ? { legacyStage: derivedLegacyStage } : {}),
                ...(derivedLevel != null ? { level: derivedLevel }          : {}),
                ...(replyRef ? { replyTo: replyRef } : {}),
            };

            const visible = await transcriptFilterFor(identity);

            // Read-modify-write under a short-lived KV lock so two concurrent
            // posters can't silently overwrite each other's message. Lock TTL
            // is bounded so a crashed lambda releases the key after a second
            // or two; under sustained contention (lock acquire fails) we fall
            // through and run unlocked rather than dropping the write.
            const updated = await withKvLock(key, async () => {
                const existing = await kv.get<ChatMessage[]>(key) ?? [];
                const next = [...existing, newMsg].slice(-MAX_MESSAGES);
                await kv.set(key, next, { ex: KV_TTL_SECONDS });
                return next;
            });
            // Everyone with this tavern open refetches now instead of on their
            // next poll. Only after the write landed — a refused post kicks nobody.
            kickVillageChat(village, newMsg.ts);

            res.status(200).json(visible(updated));
            // Tagged players hear about it after the poster has their reply.
            // Best-effort: a failed notice never fails a stored line.
            await notifyTavernMentions({
                village,
                author,
                text: safeText,
                replyToAuthor: replyRef?.author,
                at: newMsg.ts,
                canRead: villageChatWatchable,
            }).catch((err) => console.error('[village/chat] mentions', err));
            return;
        } catch (err) {
            console.error('[village/chat]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
