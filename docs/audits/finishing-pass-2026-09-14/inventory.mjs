// Read-only source inventory for this dated audit; not a runtime registry or gate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import { RUNTIME_MODE_REGISTRY } from '../../../shared/runtime-mode-registry.ts';

const root = process.cwd();
const out = path.join(root, 'docs/audits/finishing-pass-2026-09-14');
const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function files(dir) {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e =>
        e.isDirectory() && !['node_modules', 'dist'].includes(e.name) ? files(`${dir}/${e.name}`)
            : e.isFile() ? [`${dir}/${e.name}`] : []);
}
const apiFiles = files('api').filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const testFiles = ['api', 'shared', 'scripts', 'shinobij.client/src', 'shinobij.client/scripts', 'shinobij.client/e2e', 'shinobij.client/e2e-live', 'shinobij.client/e2e-visual', 'shinobij.client/e2e-warfront']
    .flatMap(files).filter(f => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
const source = read('server-api-routes.ts');
const imports = Object.fromEntries([...source.matchAll(/import\s+(\w+)\s+from\s+['"]\.\/(api\/[^'"]+)\.js['"]/g)].map(m => [m[1], `${m[2]}.ts`]));
const routes = [...source.matchAll(/route\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g)].map(m => ({ route: m[1], file: imports[m[2]] ?? null, handler: m[2] }));
write('runtime-modes.json', RUNTIME_MODE_REGISTRY);
write('mounted-routes.json', routes);

const values = /^(ryo|fateShards|boneCharms|auraStones|auraDust|honorSeals|mythicSeals|chroniclePoints|chronicleInk|xp|level|unspentStats|earnedStatPoints|jutsuTraining|jutsuXp|pets|inventory|itemStacks|equipment|tileCards|clanPoints|treasury|warSupply|rating|rankedRating|growthPoints|ownerClan|ownerVillage|control|territoryScrolls)$/;
const mutators = /^(gainXp|gainServerPetXp|credit\w+|grant\w+|award\w+|deduct\w+|spend\w+|settle\w+|transfer\w+|purchase\w+|apply\w*(?:Reward|Payout|Purchase|Donation|Settlement)|bumpLegacyStats|reportMissionEvent|mutatePlayerSave|withCrossKeySettlement|runCrossKeySettlement)$/;
const mutationSources = [];
const hashes = {};
for (const file of apiFiles) {
    const text = read(file);
    hashes[file] = crypto.createHash('sha256').update(text).digest('hex');
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const hits = [];
    function visit(node) {
        let name;
        if (ts.isPropertyAssignment(node)) name = node.name.getText(ast).replace(/['"]/g, '');
        else if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isPropertyAccessExpression(node.left)) name = node.left.name.text;
        if (name && values.test(name)) hits.push({ line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, kind: 'value-write-or-projection', field: name });
        if (ts.isCallExpression(node)) {
            const called = ts.isIdentifier(node.expression) ? node.expression.text : '';
            if (mutators.test(called)) hits.push({ line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, kind: 'mutation-or-settlement-call', symbol: called });
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    if (hits.length) mutationSources.push({ file, routes: routes.filter(r => r.file === file).map(r => r.route), candidateEvidence: hits, classification: 'REVIEW REQUIRED — syntactic discovery includes projections; see reviewed value-path registry' });
}
write('valuable-mutation-discovery.json', mutationSources);
write('api-source-hashes.json', hashes);

const testIndex = testFiles.map(file => {
    const text = read(file);
    const names = [...text.matchAll(/\b(?:it|test|describe)(?:\.(?:only|skip|todo|describe))?\(\s*(['"`])([^\n]*?)\1/g)].map(m => m[2]);
    return { file, tests: names };
});
write('test-evidence-index.json', testIndex);
console.log(JSON.stringify({ modes: RUNTIME_MODE_REGISTRY.length, mountedRoutes: routes.length, mutationCandidateFiles: mutationSources.length, indexedTestFiles: testIndex.length }));
