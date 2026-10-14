import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/*
 * docs/CI.md is what someone reads while triaging a red check, and nothing tied
 * it to ci.yml. By 2026-10-14 it had drifted on five job timeouts, the responsive
 * shard count, the server-contracts split, and a job that had grown from one
 * journey to nine live Express steps. Each of those ci.yml changes passed review;
 * the doc was simply never opened. This test fails the next such change until the
 * "Stable CI checks" section says what ci.yml does.
 *
 * ci.yml is read with line patterns, as ci-workflow-contract.test.mjs reads it,
 * because the repository has no YAML parser. The patterns assume the workflow's
 * two-space indentation. Job keys contain digits (`e2e_*`), so they are matched
 * with [A-Za-z0-9_-], never [a-z_].
 */

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const doc = readFileSync(new URL('../docs/CI.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const COUNT = `\\d+|${NUMBER_WORDS.join('|')}`;
const countOf = (text) => (/^\d+$/.test(text) ? Number(text) : NUMBER_WORDS.indexOf(text.toLowerCase()));
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SHARD_PLACEHOLDER = /\$\{\{\s*matrix\.shard\s*\}\}/;

function readJobs(source) {
    const start = source.indexOf('\njobs:\n');
    assert.ok(start >= 0, 'ci.yml has no top-level `jobs:` block');
    let block = source.slice(start + '\njobs:\n'.length);
    // The block ends at the next top-level key; a column-0 comment does not end it.
    const end = block.search(/^[^\s#]/m);
    if (end >= 0) block = block.slice(0, end);
    const heads = [...block.matchAll(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm)];
    return new Map(heads.map((head, index) => {
        const text = block.slice(head.index, heads[index + 1]?.index ?? block.length);
        return [head[1], {
            text,
            name: text.match(/^ {4}name: (.+)$/m)?.[1].trim(),
            timeout: Number(text.match(/^ {4}timeout-minutes: (\d+)[ \t]*$/m)?.[1]),
            needs: readNeeds(text),
            shards: readShards(text),
        }];
    }));
}

function readNeeds(text) {
    const inline = text.match(/^ {4}needs: (\S.*)$/m)?.[1].trim();
    if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map((need) => need.trim()).filter(Boolean);
    const listed = text.match(/^ {4}needs:\n((?: {6}- .+\n)+)/m)?.[1] ?? '';
    return [...listed.matchAll(/^ {6}- (\S+)/gm)].map((match) => match[1]);
}

// A matrix is either `shard: [1, 2, 3]` or an `include:` list of `- shard: name` entries.
function readShards(text) {
    const matrix = text.match(/^ {6}matrix:\n((?:(?: {8}.*)?\n)+)/m)?.[1];
    if (!matrix) return null;
    const inline = matrix.match(/^ {8}shard: \[([^\]]*)\]/m)?.[1];
    if (inline) return inline.split(',').map((shard) => shard.trim()).filter(Boolean);
    const listed = [...matrix.matchAll(/^ {10}- shard: (\S+)/gm)].map((match) => match[1]);
    return listed.length > 0 ? listed : null;
}

function sectionOf(markdown, heading) {
    const start = markdown.indexOf(`\n${heading}\n`);
    assert.ok(start >= 0, `docs/CI.md lost its "${heading}" heading`);
    const body = markdown.slice(start + 1);
    const end = body.indexOf('\n## ');
    return end >= 0 ? body.slice(0, end) : body;
}

function assertNoDrift(problems, topic) {
    assert.ok(problems.length === 0,
        `docs/CI.md disagrees with ci.yml on ${topic}. Update the doc in the same change:\n  - ${problems.join('\n  - ')}`);
}

const jobs = readJobs(workflow);
const stable = sectionOf(doc, '## Stable CI checks');
const ROW = /^\| `([^`]+)` \| `([^`]+)` \| (\d+) min \| (.+) \|$/;
const tableLines = stable.split('\n').filter((line) => line.startsWith('| `'));
const rows = tableLines.map((line) => line.match(ROW)).filter(Boolean)
    .map(([, context, key, minutes, duty]) => ({ context, key, minutes: Number(minutes), duty }));
const matrixJobs = [...jobs].filter(([, job]) => job.shards);
// Markdown wraps prose anywhere, including inside "29-minute ceiling" or a
// backticked check name, so prose is matched with its whitespace collapsed.
const flat = (text) => text.replace(/\s+/g, ' ');
const prose = flat(stable);
const paragraphs = stable.split(/\n\s*\n/).filter((block) => !block.startsWith('|')).map(flat);
const paragraphsNaming = (key) => paragraphs.filter((block) => block.includes(`\`${key}\``));

test('ci.yml reads as jobs this test can check', () => {
    // A parse that quietly finds nothing would make every check below vacuous.
    assert.ok(jobs.size > 0, 'read no jobs from ci.yml');
    for (const [key, job] of jobs) {
        assert.ok(job.name, `${key} has no job-level name:`);
        assert.ok(Number.isInteger(job.timeout), `${key} has no job-level timeout-minutes:`);
        if (job.name.includes('${{ matrix.')) {
            assert.ok(job.shards && SHARD_PLACEHOLDER.test(job.name),
                `${key} is named from its matrix, but this test only reads a matrix.shard list; extend readShards`);
        }
    }
});

test('every Stable CI checks row matches its job\'s check name and timeout', () => {
    assert.ok(rows.length > 0, 'the Stable CI checks table has no rows this test can read');
    const unreadable = tableLines.filter((line) => !ROW.test(line));
    assert.ok(unreadable.length === 0,
        `these rows no longer read as | \`context\` | \`job_id\` | N min | duty |:\n${unreadable.join('\n')}`);
    const problems = [];
    for (const row of rows) {
        const job = jobs.get(row.key);
        if (!job) {
            problems.push(`${row.key}: the table lists it, but ci.yml has no such job`);
            continue;
        }
        if (job.name !== row.context) problems.push(`${row.key}: the table says ${row.context}, ci.yml names it ${job.name}`);
        if (job.timeout !== row.minutes) problems.push(`${row.key}: the table says ${row.minutes} min, ci.yml has timeout-minutes: ${job.timeout}`);
    }
    assertNoDrift(problems, 'the stable-checks table');
});

test('Stable CI checks describes every ci.yml job with its real timeout', () => {
    const problems = [];
    const described = new Set(rows.map((row) => row.key));
    // Jobs outside the table appear in prose as "(`job_id`, N minutes)".
    for (const [, key, minutes] of prose.matchAll(/\(`([A-Za-z0-9_-]+)`, (\d+) minutes\)/g)) {
        described.add(key);
        const job = jobs.get(key);
        if (!job) problems.push(`(\`${key}\`, ${minutes} minutes): ci.yml has no such job`);
        else if (job.timeout !== Number(minutes)) problems.push(`${key}: the prose says ${minutes} minutes, ci.yml has timeout-minutes: ${job.timeout}`);
    }
    // A matrix job is described in its own paragraph, and every "N-minute ceiling"
    // there is its ceiling. Write a retired ceiling as plain minutes instead.
    for (const [key, job] of matrixJobs) {
        const ceilings = paragraphsNaming(key)
            .flatMap((block) => [...block.matchAll(/(\d+)-minute ceiling/g)].map((match) => Number(match[1])));
        if (ceilings.length > 0) described.add(key);
        for (const minutes of ceilings) {
            if (minutes !== job.timeout) problems.push(`${key}: its paragraph says ${minutes}-minute ceiling, ci.yml has timeout-minutes: ${job.timeout}`);
        }
    }
    for (const [key, job] of jobs) {
        if (!described.has(key)) {
            problems.push(`${key} (${job.name}, ${job.timeout} min) is not described: give it a table row, a "(\`${key}\`, ${job.timeout} minutes)" mention, or, for a matrix, a paragraph naming \`${key}\` with its "${job.timeout}-minute ceiling"`);
        }
    }
    assertNoDrift(problems, 'which jobs exist and how long they may run');
});

test('Stable CI checks names only the matrix checks ci.yml emits, and counts their shards right', () => {
    const problems = [];
    for (const [key, job] of matrixJobs) {
        const at = job.name.search(SHARD_PLACEHOLDER);
        if (at < 0) continue; // the parse test reports it
        const emitted = job.shards.map((shard) => job.name.replace(SHARD_PLACEHOLDER, shard));
        // Every backticked name that starts like this matrix's checks must be one it emits.
        const named = [...prose.matchAll(new RegExp(`\`(${escapeRegExp(job.name.slice(0, at))}[^\`]*)\``, 'g'))]
            .map((match) => match[1]);
        for (const name of new Set(named)) {
            if (!emitted.includes(name)) problems.push(`${key}: the doc names ${name}, but ci.yml emits ${emitted.join(', ')}`);
        }
        // A numbered matrix is written "first through last"; named shards are each listed.
        const numbered = job.shards.every((shard, index) => shard === String(index + 1));
        for (const name of numbered ? [emitted[0], emitted.at(-1)] : emitted) {
            if (!named.includes(name)) {
                problems.push(`${key}: the doc never names ${name}${numbered ? ` (write \`${emitted[0]}\` through \`${emitted.at(-1)}\`)` : ''}`);
            }
        }
        const passed = job.text.match(/--shard=\$\{\{\s*matrix\.shard\s*\}\}\/(\d+)/)?.[1];
        for (const block of paragraphsNaming(key)) {
            for (const [, count] of block.matchAll(new RegExp(`\\b(${COUNT})\\s+\`${escapeRegExp(key)}\``, 'gi'))) {
                if (countOf(count) !== job.shards.length) problems.push(`${key}: the doc says "${count} \`${key}\`", but ci.yml runs ${job.shards.length} shards`);
            }
            for (const [, total] of block.matchAll(/--shard=N\/(\d+)/g)) {
                if (total !== passed) problems.push(`${key}: the doc says --shard=N/${total}, but ci.yml passes ${passed ? `--shard=N/${passed}` : 'no --shard'}`);
            }
        }
        // An aggregate's row counts the shards it waits for.
        for (const row of rows.filter((candidate) => jobs.get(candidate.key)?.needs.includes(key))) {
            for (const [, count] of row.duty.matchAll(new RegExp(`\\b(${COUNT})(?:\\s+[\\w-]+){0,3}\\s+shards\\b`, 'gi'))) {
                if (countOf(count) !== job.shards.length) problems.push(`${row.key}: its row says "${count} ... shards", but ${key} runs ${job.shards.length}`);
            }
        }
    }
    assertNoDrift(problems, 'the sharded jobs');
});

test('Stable CI checks counts the live Express steps e2e_village_stores runs', () => {
    const job = jobs.get('e2e_village_stores');
    assert.ok(job, 'ci.yml lost e2e_village_stores; update this test and docs/CI.md together');
    // Steps are 6-space list items. Comment lines are dropped, so a comment that
    // mentions the command cannot count as a step.
    const steps = job.text.split(/^ {6}- /m).slice(1)
        .map((step) => step.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n'))
        .filter((step) => /\btest:e2e:live\b/.test(step));
    assert.ok(steps.length > 0, 'e2e_village_stores runs no test:e2e:live step; update this test and docs/CI.md together');
    const claims = [...prose.matchAll(new RegExp(`\\b(${COUNT}) live Express\\b`, 'gi'))].map((match) => match[1]);
    assert.ok(claims.length > 0, `docs/CI.md must say how many live Express steps e2e_village_stores runs (${steps.length})`);
    const problems = claims
        .filter((claim) => countOf(claim) !== steps.length)
        .map((claim) => `the doc says "${claim} live Express", but e2e_village_stores runs ${steps.length} test:e2e:live steps; update the count and the step list`);
    assertNoDrift(problems, 'the live Express journeys');
});
