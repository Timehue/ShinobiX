import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../../.tmp/pet-hardware-performance/', import.meta.url);
const base = JSON.parse(await readFile(new URL('measurements.json', root), 'utf8'));
const effects = JSON.parse(await readFile(new URL('effects-measurements.json', root), 'utf8'));
const host = JSON.parse((await readFile(new URL('host.json', root), 'utf8')).replace(/^\uFEFF/, ''));
const groups = new Map();
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const fixed = (n, places = 2) => Number(n.toFixed(places));
for (const sample of [...base.samples, ...effects.samples]) {
    const label = sample.mode === 'gauntlet' ? `Gauntlet 5v5 · ${sample.quality} · ${sample.lod ? 'LOD' : 'source meshes'}`
        : sample.mode === 'colosseum' ? `Colosseum 1v1 · ${sample.quality} · ${sample.action ?? 'guard loop'}`
            : `Rally · ${sample.quality} · ${sample.action ?? 'race'}`;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(sample);
}
const rows = [...groups].map(([label, samples]) => {
    const gaps = samples.flatMap(s => s.capture.frames.slice(1).map((f, i) => f.time - s.capture.frames[i].time).filter(n => n > 0));
    const frames = samples.flatMap(s => s.capture.frames);
    const ready = samples.map(s => s.modelsReadyMs).filter(Number.isFinite);
    return { label, runs: samples.length, measuredSeconds: fixed(gaps.reduce((a, b) => a + b, 0) / 1000),
        fps: fixed(gaps.length * 1000 / gaps.reduce((a, b) => a + b, 0)),
        runFpsRange: [Math.min(...samples.map(s => s.summary.fps)), Math.max(...samples.map(s => s.summary.fps))],
        p95FrameMs: fixed(percentile(gaps, .95)), p99FrameMs: fixed(percentile(gaps, .99)), worstFrameMs: fixed(Math.max(...gaps)),
        framesOver50ms: gaps.filter(n => n > 50).length,
        renderCallbackCpuP95Ms: fixed(percentile(frames.map(f => f.cpuMs), .95)),
        trianglesP50: fixed(percentile(frames.map(f => f.triangles), .5), 0), callsP50: percentile(frames.map(f => f.calls), .5),
        modelReadyMedianMs: ready.length ? fixed(percentile(ready, .5)) : null };
});
await writeFile(new URL('summary.json', root), JSON.stringify({ rows, errors: [...base.errors, ...effects.errors] }, null, 2));
const text = [
    `Measured on ${host.gpu[0].Name}, ${host.cpu[0].Name.trim()}, ${(host.memory[0].TotalVisibleMemorySize / 1048576).toFixed(1)} GiB visible RAM, Windows, Balanced power plan. GPU driver ${host.gpu[0].DriverVersion}.`,
    `Hardware-accelerated full Chromium ${base.browser.product}, ANGLE Direct3D 11, ${base.viewport.width}×${base.viewport.height}, device pixel ratio 1. The actual game contexts reported NVIDIA. The empty-page animation-frame control measured ${fixed(base.compositorControl.fps)} FPS. These are headless browser measurements on this workstation, not a mobile-device benchmark.`,
    `Each standard scenario has ${base.repeats} separate ${base.durationMs / 1000}-second samples; each effects scenario has ${effects.repeats} separate ${effects.durationMs / 1000}-second samples. All use a five-second warmup; alternate passes reverse the scenario order. Frames below are actual WebGL-drawing animation callbacks. Percentiles pool intervals within each run, never across page time origins. Screenshots were captured after samples.`,
    '| Scenario | FPS | P95 frame ms | P99 frame ms | Worst ms | Frames >50 ms | P95 render-callback CPU ms | Median triangles |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(r => `| ${r.label} | ${r.fps} | ${r.p95FrameMs} | ${r.p99FrameMs} | ${r.worstFrameMs} | ${r.framesOver50ms} | ${r.renderCallbackCpuP95Ms} | ${r.trianglesP50.toLocaleString('en-US')} |`),
    '',
    'Gauntlet uses a fixed seed and high HP so all ten pets stay active. Its source-mesh comparison changes only the LOD selector in the current renderer; this is not a before/after benchmark of all animation and loading changes. Colosseum uses two active pets and repeatedly plays a shield or signature action. Rally uses the daily fixed-seed QA practice course and four racers, with separate burst/jump/technique samples. Full versus light Rally settings are recorded separately; runtime quality is retained in the raw samples.',
    'The browser is paced at approximately 60 FPS. A near-60 average cannot quantify unused GPU headroom or prove a speedup. CPU numbers cover drawing animation callbacks, not all browser work; no GPU execution-duration claim is made. Sporadic long frames are retained, and their causes are not established by these measurements.',
    `Gauntlet model-ready medians (fresh browser contexts, local assets): ${rows.filter(r => r.modelReadyMedianMs != null).map(r => `${r.label}: ${(r.modelReadyMedianMs / 1000).toFixed(2)} s`).join('; ')}. This excludes the deliberate summon animation and does not model production network latency; OS/driver caches were not purged.`,
    `Unexpected runtime errors: ${base.errors.length + effects.errors.length}.`,
    'Raw evidence: [measurements.json](measurements.json), [effects-measurements.json](effects-measurements.json), [GPU probe](gpu-probe.json), [host metadata](host.json).',
].join('\n\n').replaceAll('|\n\n|', '|\n|');
await writeFile(new URL('report.md', root), text + '\n');
console.log(JSON.stringify(rows, null, 2));
