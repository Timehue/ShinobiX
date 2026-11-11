import { playerSlug } from './utils';

/**
 * A player's portrait from the shared image bucket, whichever spelling of the
 * player's name the caller holds.
 *
 * Every writer publishes `avatar:<display name, lowercased>` (the creator,
 * Profile), and POST /api/images accepts that id because it maps the name part
 * through safeName, the account-slug rule. So for "Kaede Morrow" the row is
 * `avatar:kaede morrow`. Server-run accounts also publish `avatar:<slug>`.
 * Ranked, spectate and other server records hold the slug ("kaedemorrow"),
 * which cannot be turned back into the display name. So try the exact key,
 * then any avatar row whose name has the caller's slug. Only that account (or
 * an admin) can write such a row, so the match is never another player.
 */
const bySlug = new WeakMap<Record<string, string>, Map<string, string>>();

export function sharedAvatarFor(images: Record<string, string> | null | undefined, name: string | null | undefined): string {
    if (!images || !name) return '';
    const exact = images['avatar:' + name.trim().toLowerCase()];
    if (exact) return exact;
    let index = bySlug.get(images);
    if (!index) {
        bySlug.set(images, index = new Map());
        for (const key in images) {
            const slug = key.startsWith('avatar:') && images[key] ? playerSlug(key.slice(7)) : '';
            if (slug && !index.has(slug)) index.set(slug, images[key]);
        }
    }
    return index.get(playerSlug(name)) || '';
}
