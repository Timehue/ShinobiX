import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// read_portrait runs from /root/modal_sprite_worker.py; the painted-costume modules live in the baked
// install folder (/opt/sprite), which is not on that function's import path. Importing one of them
// without putting INSTALL on sys.path first killed every portrait check from 2026-11-21 to 11-24
// ("ModuleNotFoundError: No module named 'animal_build'"). The python tests never see it, because they
// run with the worker folder on the path, so this reads the function itself.
const source = readFileSync(new URL('../workers/avatar-model/modal_sprite_worker.py', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function functionBody(name) {
    const start = source.indexOf(`\ndef ${name}(`);
    assert.ok(start >= 0, `${name} is defined in modal_sprite_worker.py`);
    const next = source.slice(start + 1).search(/\n(?:@|def |class )/);
    return source.slice(start, next < 0 ? undefined : start + 1 + next);
}

test('read_portrait puts the baked install folder on the import path before importing its modules', () => {
    const body = functionBody('read_portrait');
    const path = body.indexOf('sys.path.insert(0, str(INSTALL))');
    assert.ok(path >= 0, 'read_portrait must add INSTALL to sys.path');
    const imports = [...body.matchAll(/^\s+from (\w+) import /gm)];
    assert.ok(imports.length > 0, 'expected read_portrait to import a worker module');
    for (const found of imports) assert.ok(path < found.index, `sys.path must be set before "from ${found[1]} import"`);
});

test('every module read_portrait imports is copied into the worker image', () => {
    const body = functionBody('read_portrait');
    for (const [, module] of body.matchAll(/^\s+from (\w+) import /gm))
        assert.match(source, new RegExp(`"${module}\\.py"`), `${module}.py must be added to the worker image`);
});
