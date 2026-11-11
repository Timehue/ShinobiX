import { playerSlug } from './utils';

/**
 * A player's portrait from the shared image bucket.
 *
 * Every writer publishes `avatar:<display name, lowercased>` (the creator,
 * Profile), and POST /api/images accepts that id because it maps the name part
 * through the same safeName rule as the account slug. So for "Kaede Morrow" the
 * row is `avatar:kaede morrow`, not `avatar:kaedemorrow`. A lookup by slug alone
 * misses it and the peer shows initials. Try the display-name key first, then
 * the slug key, which server-run accounts also publish.
 */
export function sharedAvatarFor(images: Record<string, string> | undefined, name: string): string {
    return images?.['avatar:' + name.trim().toLowerCase()] || images?.['avatar:' + playerSlug(name)] || '';
}
