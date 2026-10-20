/** QA previews accept only shipped portrait paths, never arbitrary URL schemes. */
export function previewAvatarSource(value: string | null): string {
    if (value === '/starter-avatar-one.webp') return '/starter-avatar-one.webp';
    if (value === '/starter-avatar-two.webp') return '/starter-avatar-two.webp';
    if (!value || !/^\/portraits\/[a-z0-9_/-]+\.(?:png|webp|jpe?g)$/i.test(value)) return '';
    // Reconstruct a rooted path from encoded segments. No query, traversal,
    // backslash, control character or executable scheme reaches an image sink.
    return '/portraits/' + value.slice('/portraits/'.length).split('/').map(encodeURIComponent).join('/');
}
