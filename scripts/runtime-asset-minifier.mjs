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
