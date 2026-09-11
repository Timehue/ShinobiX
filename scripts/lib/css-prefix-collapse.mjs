/**
 * lightningcss prefix collapse — detection for source and built CSS.
 *
 * lightningcss is the production CSS minifier here: Vite 8 hands CSS to it for
 * every `build.cssMinify` value except 'esbuild'. For `backdrop-filter` and
 * `filter` it keeps ONE slot per rule for the whole prefix family, and a later
 * declaration replaces an earlier one, prefix set and all. So the conventional
 * spelling
 *
 *     backdrop-filter: blur(3px);
 *     -webkit-backdrop-filter: blur(3px);
 *
 * ships as `-webkit-backdrop-filter:blur(3px)` alone. Chromium and Firefox do
 * not support -webkit-backdrop-filter at all (CSS.supports is false in both), so
 * the blur is gone for them while Safari keeps it. That is how the lite-fx
 * backdrop kill (and 17 other rules) went dead in Chrome; found 2026-09-10.
 * Reproduced on lightningcss 1.33 with and without targets, minified or not.
 *
 * `filter` collapses the same way. It is harmless today, because all three
 * engines still honour the -webkit-filter alias. It is policed anyway so the
 * standard property always survives into the build.
 *
 * Every other prefixed pair in the tree (mask-*, user-select, appearance,
 * line-clamp, background-clip, backface-visibility) survives in either order,
 * so only these two families are policed.
 *
 * The rule for source is to write the standard property only. The build's
 * `cssTarget` includes safari17, which makes lightningcss emit the -webkit-
 * twin itself, in the order that survives.
 */

/** Standard properties whose `-webkit-` twin lightningcss merges into one slot. */
export const COLLAPSING_PROPERTIES = Object.freeze(['backdrop-filter', 'filter']);

const PROPERTY_NAME = /^-{0,2}[a-z][a-z0-9-]*$/;

function skipString(css, start) {
    const quote = css[start];
    for (let i = start + 1; i < css.length; i++) {
        if (css[i] === '\\') i++;
        else if (css[i] === quote || css[i] === '\n') return i;
    }
    return css.length;
}

/** Replaces comments with spaces (keeping newlines) so offsets and line numbers survive. */
function blankComments(css) {
    let out = '';
    let copied = 0;
    for (let i = 0; i < css.length; i++) {
        const ch = css[i];
        if (ch === '"' || ch === "'") {
            i = skipString(css, i);
        } else if (ch === '/' && css[i + 1] === '*') {
            const close = css.indexOf('*/', i + 2);
            const end = close === -1 ? css.length : close + 2;
            out += css.slice(copied, i) + css.slice(i, end).replace(/[^\n]/g, ' ');
            copied = end;
            i = end - 1;
        }
    }
    return out + css.slice(copied);
}

/**
 * Yields every `{...}` block with the declarations written directly inside it:
 * `{ prelude, declarations: [{ property, value, index }] }`, where `index` is
 * the declaration's offset in `css`. Declarations of nested rules belong to
 * the nested block, not the parent. Strings, comments and anything inside
 * parentheses are opaque, so `content:"}"` or `url(data:...;base64,...)`
 * cannot end a block or split a declaration.
 */
export function* declarationBlocks(css) {
    const text = blankComments(css);
    const stack = [];
    let statementStart = 0;
    let parens = 0;

    const flushDeclaration = (end) => {
        const block = stack[stack.length - 1];
        if (!block) return;
        const raw = text.slice(statementStart, end);
        const colon = raw.indexOf(':');
        if (colon === -1) return;
        const property = raw.slice(0, colon).trim().toLowerCase();
        if (!PROPERTY_NAME.test(property)) return;
        const lead = raw.length - raw.trimStart().length;
        block.declarations.push({ property, value: raw.slice(colon + 1).trim(), index: statementStart + lead });
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' || ch === "'") {
            i = skipString(text, i);
        } else if (ch === '\\') {
            i++;
        } else if (ch === '(') {
            parens++;
        } else if (ch === ')') {
            if (parens > 0) parens--;
        } else if (parens > 0) {
            continue;
        } else if (ch === ';') {
            flushDeclaration(i);
            statementStart = i + 1;
        } else if (ch === '{') {
            stack.push({ prelude: text.slice(statementStart, i).trim().replace(/\s+/g, ' '), declarations: [] });
            statementStart = i + 1;
        } else if (ch === '}') {
            flushDeclaration(i);
            const block = stack.pop();
            if (block) yield block;
            statementStart = i + 1;
        }
    }
}

/**
 * Built-CSS check: rule blocks that carry a `-webkit-` twin from
 * COLLAPSING_PROPERTIES without the standard property. For backdrop-filter,
 * Chromium and Firefox render those blocks with no blur at all.
 */
export function findCollapsedPrefixes(css) {
    const hits = [];
    for (const block of declarationBlocks(css)) {
        const declared = new Set(block.declarations.map((d) => d.property));
        for (const property of COLLAPSING_PROPERTIES) {
            if (declared.has(`-webkit-${property}`) && !declared.has(property)) {
                hits.push({ prelude: block.prelude, property });
            }
        }
    }
    return hits;
}

/**
 * Source check: every hand-written `-webkit-` twin of COLLAPSING_PROPERTIES,
 * with its 1-based line. Feature queries such as
 * `@supports (-webkit-backdrop-filter: none)` are preludes, not declarations,
 * and are not reported.
 */
export function findHandWrittenPrefixes(css) {
    const twins = new Set(COLLAPSING_PROPERTIES.map((property) => `-webkit-${property}`));
    const hits = [];
    for (const block of declarationBlocks(css)) {
        for (const declaration of block.declarations) {
            if (!twins.has(declaration.property)) continue;
            const line = css.slice(0, declaration.index).split('\n').length;
            hits.push({ prelude: block.prelude, property: declaration.property, line });
        }
    }
    return hits;
}
