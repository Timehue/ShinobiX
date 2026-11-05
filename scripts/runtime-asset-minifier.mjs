import { transformSync } from 'esbuild';

/** Minify a standalone browser runtime script without lowering its syntax target. */
export function minifyRuntimeSource(source) {
    return transformSync(source, {
        minify: true,
        legalComments: 'none',
    }).code;
}

/** Compact generated JSON metadata without changing its parsed graph. */
export function minifyRuntimeJson(source) {
    return JSON.stringify(JSON.parse(source));
}

/** Remove explanatory template comments before the shell is copied to legal
 * pages. Keep conditional, server and email-protection directives intact. */
export function minifyRuntimeHtmlComments(source) {
    return source.replace(/<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--([\s\S]*?)-->/gi, (match, rawTag, body) =>
        rawTag || /^\s*(?:\[|<!\[|#|\/?email_off\b)/i.test(body) ? match : '');
}
