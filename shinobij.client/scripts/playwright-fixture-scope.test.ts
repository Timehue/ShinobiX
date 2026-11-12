import assert from 'node:assert/strict';
import test from 'node:test';
import smoke from '../playwright.config';
import roster from '../playwright.sector-model-roster.config';

const localFixtures=['sector-model-roster','stronghold-model','hollow-gate-model','weekly-model'];
function ignored(patterns: unknown, spec: string) {
    return (Array.isArray(patterns) ? patterns : [patterns]).some(pattern=>pattern==='**/'+spec+'.spec.ts');
}

test('every ordinary browser project excludes private roster inputs and source-only model fixtures',()=>{
    assert.ok(smoke.projects?.length);
    for(const project of smoke.projects!) for(const spec of localFixtures)
        assert.ok(ignored(project.testIgnore ?? smoke.testIgnore,spec),project.name+' collected '+spec);
});

test('dedicated roster qualification enables the complete roster on every configured browser project',()=>{
    assert.equal(roster.testMatch,'sector-model-roster.spec.ts');
    assert.deepEqual(roster.projects?.map(p=>p.name),smoke.projects?.map(p=>p.name));
    for(const project of roster.projects!)
        assert.equal(ignored(project.testIgnore ?? roster.testIgnore,'sector-model-roster'),false,project.name);
});
