/*
 * The viewer's OWN portrait, with the same fallback every other render site has.
 *
 * Avatars live in the shared image bucket under `avatar:<name>`; the client
 * hydrates that into `character.avatarImage` once loadCategory('avatar') lands.
 * Almost every surface that draws a portrait (world map, tavern, user hub,
 * roster, VN stage, Chronicle board, sector peers) reads
 * `sharedImages['avatar:<name>']` FIRST and only falls back to the character
 * field — see the invariant documented in lib/presence-character.ts, which is
 * why the presence heartbeat is allowed to drop the avatar entirely.
 *
 * The player's own surfaces were the exception: LeftProfileCard/ProfileCardBody,
 * MobileNav, MobileStatusHUD and the sector marker read `character.avatarImage`
 * alone, so any moment that field was empty they showed initials — while every
 * OTHER player saw the portrait fine. That window was not rare: the save clamp
 * used to strip `avatarImage` on write, so it was empty on every login until the
 * manifest fetch resolved, and for the whole session if that fetch failed.
 *
 * This is a tiny external store rather than props because the four surfaces sit
 * behind different hosts (desktop rail, mobile sheet, mobile nav, world map) and
 * threading `sharedImages` to all of them would mean prop-drilling through
 * App.tsx, which is under a line-budget ratchet. App publishes the resolved
 * fallback; the surfaces subscribe. Renderer-only — no network, no saves.
 */
import { useSyncExternalStore } from "react";

let ownAvatarFallback = "";
const subscribers = new Set<() => void>();

/** App publishes `sharedImages['avatar:<own name>']` here whenever it changes. */
export function setOwnAvatarFallback(url: string | undefined | null): void {
    const next = url || "";
    if (next === ownAvatarFallback) return;
    ownAvatarFallback = next;
    for (const notify of subscribers) notify();
}

function subscribe(notify: () => void): () => void {
    subscribers.add(notify);
    return () => { subscribers.delete(notify); };
}

function getSnapshot(): string {
    return ownAvatarFallback;
}

/**
 * The portrait to draw for the local player. Prefers the character field (a
 * just-uploaded inline image paints instantly, before the publish round-trip
 * shows up in the shared bucket) and falls back to the name-keyed shared image.
 */
export function useOwnAvatar(character: { avatarImage?: string } | null | undefined): string {
    const fallback = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return character?.avatarImage || fallback;
}

/**
 * Same resolution, for call sites that already hold `sharedImages` (WorldMap)
 * and so don't need the store. Same precedence as useOwnAvatar.
 */
export function resolveOwnAvatar(
    character: { name?: string; avatarImage?: string } | null | undefined,
    sharedImages: Record<string, string> | undefined,
): string {
    if (character?.avatarImage) return character.avatarImage;
    const name = (character?.name ?? "").trim().toLowerCase();
    return (name && sharedImages?.["avatar:" + name]) || "";
}

/** Test seam / non-React readers. */
export function getOwnAvatarFallback(): string {
    return ownAvatarFallback;
}
