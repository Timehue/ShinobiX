import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Review evidence (screenshots, renders, audit dumps) is what grew this repo to
// ~10.5 GB: docs/screenshots alone is 8.4 GB. Railway could not fetch a snapshot
// that size, and every CI job needs a sparse checkout to avoid downloading it.
// This guard runs on pull requests and refuses new bulk evidence in those three
// folders, so the tree stops growing while the files are moved out of git.
export const WATCHED_PREFIXES = ['docs/screenshots/', 'docs/evidence/', 'docs/audits/'];
export const MAX_ADDED_FILES = 20;
export const HEAVY_EXTENSIONS = /\.(png|webp|jpe?g|gif|avif|bmp|tiff?|mp4|webm|mov|glb|zip|tgz|gz)$/i;
export const OVERRIDE_LABEL = 'allow-evidence';

// `renamed` and `removed` add no new blob, so they never count as growth.
const GROWING_STATUSES = new Set(['added', 'modified', 'changed', 'copied']);

/**
 * @param {{ filename: string, status: string }[]} files  the PR's changed files
 * @param {string[]} labels  the PR's label names
 */
export function evidenceGrowth(files, labels = []) {
    const grown = files.filter(file => GROWING_STATUSES.has(file.status)
        && WATCHED_PREFIXES.some(prefix => file.filename.startsWith(prefix)));
    const heavy = grown.filter(file => HEAVY_EXTENSIONS.test(file.filename));
    const failures = [];
    if (heavy.length) failures.push(`${heavy.length} image/video/binary file(s) added or changed (first: ${heavy[0].filename})`);
    if (grown.length > MAX_ADDED_FILES) failures.push(`${grown.length} files added or changed, over the limit of ${MAX_ADDED_FILES}`);
    return { grown: grown.length, heavy: heavy.length, failures, overridden: failures.length > 0 && labels.includes(OVERRIDE_LABEL) };
}

export function flattenPages(parsed) {
    // `gh api --paginate --slurp` yields an array of pages, each an array of files.
    return Array.isArray(parsed) && parsed.every(Array.isArray) ? parsed.flat() : parsed;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const files = flattenPages(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    const labels = JSON.parse(process.env.LABELS || '[]');
    const result = evidenceGrowth(files, labels);
    console.log(JSON.stringify({ changedFiles: files.length, ...result }));
    if (result.failures.length && !result.overridden) {
        console.error(`::error::${result.failures.join('; ')}.`);
        console.error([
            `This pull request adds review evidence under ${WATCHED_PREFIXES.join(', ')}.`,
            'Those folders are being moved out of git (the tree is ~10.5 GB), so new bulk',
            'evidence should not land here: write screenshots and render output to a',
            'gitignored folder such as .ci-evidence/ and attach what a reviewer needs to the PR.',
            `If the change really needs evidence committed (the pet shape-review gate still`,
            `hashes receipt evidence from the repo), add the "${OVERRIDE_LABEL}" label.`,
        ].join('\n'));
        process.exitCode = 1;
    } else if (result.overridden) {
        console.log(`::warning::Evidence growth allowed by the "${OVERRIDE_LABEL}" label: ${result.failures.join('; ')}.`);
    }
}
