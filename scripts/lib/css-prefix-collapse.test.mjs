import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    COLLAPSING_PROPERTIES,
    declarationBlocks,
    findCollapsedPrefixes,
    findHandWrittenPrefixes,
} from './css-prefix-collapse.mjs';

// The scanner behind two gates: scripts/verify-dist.mjs runs findCollapsedPrefixes
// over the SHIPPED CSS, and the corpus test below runs findHandWrittenPrefixes
// over the client source so the mistake is caught before anything is built.

const CLIENT_SRC = fileURLToPath(new URL('../../shinobij.client/src/', import.meta.url));

function cssFiles(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) cssFiles(full, out);
        else if (entry.name.endsWith('.css')) out.push(full);
    }
    return out;
}

const summarize = (css) => [...declarationBlocks(css)].map((b) => [b.prelude, b.declarations.map((d) => d.property)]);

test('declarationBlocks reads minified output, nested at-rules and pretty source alike', () => {
    assert.deepEqual(
        summarize('@media (max-width:979px){.a{color:red;backdrop-filter:none}}.b{filter:blur(1px)}'),
        [['.a', ['color', 'backdrop-filter']], ['@media (max-width:979px)', []], ['.b', ['filter']]],
    );
    assert.deepEqual(
        summarize('html.lite-fx,\nhtml.lite-fx * {\n    backdrop-filter: none !important;\n}\n'),
        [['html.lite-fx, html.lite-fx *', ['backdrop-filter']]],
    );
    // A nested rule's declarations belong to it, not to the parent.
    assert.deepEqual(
        summarize('.a{color:red;&:hover{filter:none}opacity:1}'),
        [['&:hover', ['filter']], ['.a', ['color', 'opacity']]],
    );
});

test('strings, url() and comments cannot end a block or split a declaration', () => {
    assert.deepEqual(
        summarize('.a{content:"}";background:url(data:image/svg+xml;base64,QUJD);-webkit-backdrop-filter:none}'),
        [['.a', ['content', 'background', '-webkit-backdrop-filter']]],
    );
    assert.deepEqual(
        summarize(".a{ /* note: braces { } and ; here */ backdrop-filter: none; content: '{' }"),
        [['.a', ['backdrop-filter', 'content']]],
    );
});

test('findCollapsedPrefixes flags exactly the shape lightningcss emits for a collapsed pair', () => {
    // The lite-fx blanket rule as it shipped before the fix.
    assert.deepEqual(
        findCollapsedPrefixes('html.lite-fx,html.lite-fx *,html.lite-fx :before,html.lite-fx :after{-webkit-backdrop-filter:none!important}'),
        [{ prelude: 'html.lite-fx,html.lite-fx *,html.lite-fx :before,html.lite-fx :after', property: 'backdrop-filter' }],
    );
    assert.deepEqual(findCollapsedPrefixes('.a{-webkit-filter:blur(2px)}'), [{ prelude: '.a', property: 'filter' }]);

    for (const healthy of [
        '.a{-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}',
        '.a{backdrop-filter:blur(3px)}',
        '.a{-webkit-mask-image:none}', // not a collapsing family
        '@supports (-webkit-backdrop-filter:none){.a{color:red}}', // a feature query, not a declaration
    ]) {
        assert.deepEqual(findCollapsedPrefixes(healthy), [], healthy);
    }
    assert.deepEqual([...COLLAPSING_PROPERTIES], ['backdrop-filter', 'filter']);
});

test('findHandWrittenPrefixes reports source lines and ignores feature queries', () => {
    const css = [
        '@supports (-webkit-backdrop-filter: none) {',
        '  .a {',
        '    backdrop-filter: blur(3px);',
        '    -webkit-backdrop-filter: blur(3px);',
        '  }',
        '}',
        '.b { -webkit-filter: none; }',
    ].join('\n');
    assert.deepEqual(findHandWrittenPrefixes(css), [
        { prelude: '.a', property: '-webkit-backdrop-filter', line: 4 },
        { prelude: '.b', property: '-webkit-filter', line: 7 },
    ]);
});

test('client source CSS never hand-writes a -webkit-backdrop-filter / -webkit-filter twin', () => {
    const files = cssFiles(CLIENT_SRC);
    assert.ok(files.length > 50, `expected the client stylesheet corpus, found ${files.length} files`);
    const offenders = files.flatMap((file) => findHandWrittenPrefixes(readFileSync(file, 'utf8'))
        .map((hit) => `${path.relative(CLIENT_SRC, file).replaceAll('\\', '/')}:${hit.line} ${hit.property}`));
    assert.deepEqual(
        offenders,
        [],
        'Write only the standard property. The production minifier (lightningcss) keeps one slot for '
        + 'backdrop-filter/-webkit-backdrop-filter (and filter/-webkit-filter), so a twin written after '
        + 'the standard property REPLACES it; for backdrop-filter, Chromium and Firefox then get no blur '
        + 'at all. The build target (cssTarget safari17) already makes lightningcss emit the -webkit- '
        + 'twin for Safari. See scripts/lib/css-prefix-collapse.mjs.',
    );
});
