import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertLoadSafety } from './unrestricted-load-lib.mjs';
import { evaluateConcurrencyResponses, validateConcurrencyManifest } from './unrestricted-concurrency-lib.mjs';

function option(name, fallback = '') {
    const prefix = `--${name}=`;
    return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const baseUrl = option('base-url', 'http://127.0.0.1:3000').replace(/\/$/, '');
const manifestPath = option('manifest');
const outputPath = resolve(option('output', 'concurrency-load-evidence.json'));
if (!manifestPath) throw new Error('Pass --manifest=path/to/disposable-concurrency.json.');
const safety = assertLoadSafety({ baseUrl, clients: 25, durationSeconds: 5 });
if (safety.production) throw new Error('Concurrency mutation drills are forbidden against production. Use a disposable target.');
const scenarios = validateConcurrencyManifest(JSON.parse(await readFile(resolve(manifestPath), 'utf8')));
const evidence = { schemaVersion: 1, startedAt: new Date().toISOString(), target: new URL(baseUrl).origin, scenarios: [] };

for (const scenario of scenarios) {
    const started = performance.now();
    const responses = await Promise.all(Array.from({ length: scenario.parallel }, async () => {
        const requestStarted = performance.now();
        try {
            const response = await fetch(`${baseUrl}${scenario.path}`, {
                method: scenario.method,
                headers: { 'content-type': 'application/json', 'x-player-name': scenario.playerName, 'x-player-token': scenario.token },
                body: JSON.stringify(scenario.body),
                signal: AbortSignal.timeout(30_000),
            });
            const responseText = await response.text();
            let body;
            try { body = responseText ? JSON.parse(responseText) : null; } catch { body = { nonJson: true }; }
            return { status: response.status, latencyMs: Math.round((performance.now() - requestStarted) * 10) / 10, body };
        } catch (error) {
            return { transportError: error instanceof Error ? error.name : 'Error', latencyMs: Math.round((performance.now() - requestStarted) * 10) / 10 };
        }
    }));
    const verdict = evaluateConcurrencyResponses(scenario, responses);
    const statuses = {};
    for (const response of responses) {
        const key = response.transportError ? 'transport-error' : String(response.status);
        statuses[key] = (statuses[key] ?? 0) + 1;
    }
    evidence.scenarios.push({ name: scenario.name, path: scenario.path, method: scenario.method, parallel: scenario.parallel, durationMs: Math.round((performance.now() - started) * 10) / 10, statuses, mutationCount: verdict.mutationCount, failures: verdict.failures, ok: verdict.ok });
}

evidence.completedAt = new Date().toISOString();
evidence.ok = evidence.scenarios.every((scenario) => scenario.ok);
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ ok: evidence.ok, output: outputPath, scenarios: evidence.scenarios }, null, 2));
if (!evidence.ok) process.exitCode = 1;
