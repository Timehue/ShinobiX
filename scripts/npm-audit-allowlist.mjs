// node scripts/npm-audit-allowlist.mjs <package-dir>
//
// Second opinion for a failed `npm audit --audit-level=high`: passes only when EVERY
// high or critical advisory in that package's tree is listed in npm-audit-allowlist.json
// with a reason and an unexpired date. Anything else, including an advisory npm cannot
// attribute to a GHSA id, still fails. Exit 0 = allowed, 1 = a real failure.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** GHSA ids of every high/critical advisory in an `npm audit --json` report. */
export function blockingAdvisories(report) {
    const ids = new Map();
    for (const vuln of Object.values(report?.vulnerabilities ?? {})) {
        for (const via of vuln.via ?? []) {
            if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue;
            const id = String(via.url ?? '').match(/GHSA-[\w-]+/)?.[0] ?? `unattributed:${via.source ?? via.title}`;
            ids.set(id, { id, title: via.title, package: via.name ?? vuln.name });
        }
    }
    return [...ids.values()];
}

/** Which blocking advisories the allowlist does not cover on `today` (YYYY-MM-DD). */
export function uncovered(advisories, allowlist, today) {
    const allowed = new Map((allowlist?.advisories ?? [])
        .filter(entry => entry.id && entry.reason && entry.expires && today <= entry.expires)
        .map(entry => [entry.id, entry]));
    return advisories.filter(advisory => !allowed.has(advisory.id));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const dir = process.argv[2] ?? '.';
    let raw;
    try { raw = execFileSync('npm', ['audit', '--json', '--prefix', dir], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (error) { raw = error.stdout; } // npm audit exits non-zero when it finds anything
    const report = JSON.parse(raw);
    const allowlist = JSON.parse(readFileSync(new URL('./npm-audit-allowlist.json', import.meta.url), 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    const advisories = blockingAdvisories(report), left = uncovered(advisories, allowlist, today);
    for (const advisory of advisories) console.log(`[audit-allowlist] ${left.includes(advisory) ? 'BLOCKING' : 'allowed '} ${advisory.id} ${advisory.package}: ${advisory.title}`);
    process.exit(left.length ? 1 : 0);
}
