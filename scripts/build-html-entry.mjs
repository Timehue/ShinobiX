function htmlAttribute(tag, name) {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'i'));
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

/** Return the root-relative built JS entry, never an earlier classic helper. */
export function moduleEntryReference(html) {
    for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
        const tag = match[0];
        if (htmlAttribute(tag, 'type')?.toLowerCase() !== 'module') continue;
        const src = htmlAttribute(tag, 'src');
        const entry = src?.match(/^\/([^?#]+\.js)(?:[?#].*)?$/i)?.[1];
        if (entry) return entry;
    }
    return undefined;
}
