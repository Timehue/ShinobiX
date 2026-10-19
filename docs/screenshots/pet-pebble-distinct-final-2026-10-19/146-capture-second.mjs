import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const rows = [["starter-earth","pebble-distinct-contact-v2"]];
const run = (script, args, log) => {
  try {
    const out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/' + script + '.mjs', ...args], { encoding: 'utf8', timeout: 1200000, maxBuffer: 20e6 });
    if (log) writeFileSync(log, out); console.log(script + ' ' + args.filter(a => a.startsWith('--model=') || a.startsWith('--label=')).join(' ') + ' completed');
  } catch (e) { if (log) writeFileSync(log, (e.stdout ?? '') + (e.stderr ?? '')); throw e; }
};
const base = ['--base-url=https://localhost:5207', '--ignore-https-errors'];
for (const [id, stem] of rows) {
  const prefix = 'independent-' + stem + '-final', labels = [];
  console.log('Retaining successful final face/source-geometry probes from initial capture attempt.');
  for (const stage of ['source', 'battle']) {
    if(stage==='battle')run('audit-all-pet-animation-poses', ['--model=' + id, '--full-geometry', '--label=' + prefix + '-' + stage, ...(stage === 'battle' ? ['--asset-root=public/pet-models/warfront-lod'] : [])], '.tmp/' + stem + '-final-' + stage + '-geometry.log');
    for (const part of ['head', 'body']) {
      const label = prefix + '-' + stage + '-' + part; labels.push(label);
      run('capture-pet-shape-audit', ['--model=' + id, ...base, '--production-diffuse', ...(stage === 'battle' ? ['--asset-root=/pet-models/warfront-lod'] : []), ...(part === 'head' ? ['--head', '--opposite-head-side', '--independent-faces'] : ['--tight-body']), '--progress=0,.2,.4,.6,.8,1', '--label=' + label]);
    }
  }
  execFileSync(process.execPath, ['.tmp/slice-pet-reviewed-label.mjs', ...labels], { stdio: 'inherit' });
  for (const quality of ['low', 'medium']) {
    const label = prefix + '-runtime-' + quality;
    run('capture-pet-runtime-transitions', ['--model=' + id, ...base, '--quality=' + quality, '--landmark-cameras', '--require-independent-faces', '--label=' + label]);
    execFileSync(process.execPath, ['.tmp/slice-pet-reviewed-label.mjs', label], { stdio: 'inherit' });
  }
  run('capture-pet-companion-audit', ['--model=' + id, ...base, '--label=' + stem + '-final-companions']);
  const label = prefix + '-techniques';
  run('capture-pet-companion-techniques', ['--model=' + id, ...base, '--label=' + label]);
  execFileSync(process.execPath, ['.tmp/make-technique-inspection-strips.mjs', label], { stdio: 'inherit' });
  console.log(JSON.stringify({ id, prefix, captured: true, actuallyInspectedSecondPass: false }));
}
