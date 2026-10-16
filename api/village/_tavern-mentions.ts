import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { sanitizeUserText, TEXT_LIMITS } from '../_text-moderation.js';
import { blockRelationship } from '../player/_blocks.js';
import { pushOfflineNotice } from '../player/_offline-notices.js';
import { kickPlayer } from '../_realtime/notify.js';

/*
 * Tavern mentions. A line that tags a player ("@Rill", or a reply to one of
 * their lines) leaves that player a small notice: the heartbeat delivers it and
 * the client shows a toast, not the "While you were away" digest.
 *
 * Only players who could read the line are told: the same village, past the
 * guest lock, with no block between the two. Each line tags at most a few
 * players, and one author can ping the same player once a minute, so a busy
 * room or a spammer cannot flood anyone.
 */

export const TAVERN_MENTION_MAX_TARGETS = 3;
export const TAVERN_MENTION_COOLDOWN_SEC = 60;
/** Names may contain spaces ("Storm Walker"), so a tag can run over this many words. */
const MAX_TAG_WORDS = 3;
const SNIPPET_LIMIT = 80;

/**
 * Every `@` tag in a line, each as its candidate slugs, LONGEST first:
 * "@Storm Walker, hi" → ["stormwalkerhi", "stormwalker", "storm"]. The caller
 * takes the first candidate that names a real reader, so "Storm Walker" wins
 * over a player called "Storm". An `@` inside a word ("a@b") is not a tag.
 */
export function mentionCandidates(text: string): string[][] {
    const tags: string[][] = [];
    for (const match of text.matchAll(/(?:^|[^\p{L}\p{N}_@])@([^\s@]+(?:[ \t]+[^\s@]+){0,2})/gu)) {
        const words = match[1].split(/[ \t]+/).slice(0, MAX_TAG_WORDS);
        const slugs: string[] = [];
        for (let count = words.length; count >= 1; count -= 1) {
            const slug = safeName(words.slice(0, count).join(''));
            if (slug.length >= 2 && !slugs.includes(slug)) slugs.push(slug);
        }
        if (slugs.length) tags.push(slugs);
    }
    return tags;
}

/** The best guess at each tag's slug without reading saves (tests, logs). */
export function mentionedSlugs(text: string): string[] {
    return [...new Set(mentionCandidates(text).map((slugs) => slugs[slugs.length - 1]))];
}

export function tavernMentionCooldownKey(authorSlug: string, targetSlug: string): string {
    return `tavern-mention-cd:${authorSlug}:${targetSlug}`;
}

function snippet(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > SNIPPET_LIMIT ? `${flat.slice(0, SNIPPET_LIMIT - 1)}…` : flat;
}

export async function notifyTavernMentions(input: {
    village: string;
    author: string;
    text: string;
    replyToAuthor?: string;
    at: number;
    /** The tavern's own reader gate (membership + guest lock). */
    canRead: (player: string, village: string) => Promise<boolean>;
}): Promise<string[]> {
    const authorSlug = safeName(input.author);
    // The notice prints this name; cap it like any other player name.
    const authorName = sanitizeUserText(input.author, TEXT_LIMITS.playerName) || authorSlug;
    const reachable = (slug: string) => slug !== authorSlug && input.canRead(slug, input.village).catch(() => false);

    // Resolve each tag to the longest candidate that is a reader of this room.
    const targets = new Set<string>();
    if (input.replyToAuthor) {
        const replied = safeName(input.replyToAuthor);
        if (replied && await reachable(replied)) targets.add(replied);
    }
    for (const slugs of mentionCandidates(input.text)) {
        if (targets.size >= TAVERN_MENTION_MAX_TARGETS) break;
        for (const slug of slugs) {
            if (targets.has(slug)) break;
            if (await reachable(slug)) { targets.add(slug); break; }
        }
    }

    const notified = await Promise.all([...targets].slice(0, TAVERN_MENTION_MAX_TARGETS).map(async (target) => {
        const cooldownKey = tavernMentionCooldownKey(authorSlug, target);
        let cooling = false;
        try {
            const blocks = await blockRelationship(target, authorSlug);
            if (blocks.aBlockedB || blocks.bBlockedA) return null;
            if (await kv.set(cooldownKey, 1, { ex: TAVERN_MENTION_COOLDOWN_SEC, nx: true }) === null) return null;
            cooling = true;
            await pushOfflineNotice(target, {
                kind: 'tavern-mention',
                by: authorName,
                village: input.village,
                sector: 0,
                at: input.at,
                text: snippet(input.text),
            });
            kickPlayer(target, 'mention');
            return target;
        } catch (err) {
            console.error('[village/chat] mention notice failed', target, err);
            // A notice that never landed must not hold the author's next ping.
            if (cooling) await kv.del(cooldownKey).catch(() => undefined);
            return null;
        }
    }));
    return notified.filter((t): t is string => t !== null);
}
