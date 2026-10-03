import { transformSync } from 'esbuild';

/** Minify a standalone browser runtime script without lowering its syntax target. */
export function minifyRuntimeSource(source) {
    return transformSync(source, {
        minify: true,
        legalComments: 'none',
    }).code;
}
