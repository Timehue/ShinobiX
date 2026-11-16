import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ARRIVAL_WARM_FIGURES, arrivalFigures} from './sector-arrival-figures';

const modelFor = (image: string) => image.startsWith('fit:') ? image.slice(4) : undefined;

test('the player figure is warmed first, then each fitted model once in road order', () => {
    const self = {kind: 'starter-one', style: 'B' as const};
    const figures = arrivalFigures(self, ['fit:monk', 'portrait.png', 'fit:courier', 'fit:monk'], modelFor);
    assert.deepEqual(figures.map(figure => figure.kind), ['starter-one', 'monk', 'courier']);
    assert.equal(figures[0]!.style, 'B', 'the player keeps their chosen running style');
    assert.equal(figures[1]!.style, 'A');
});

test('a road person sharing the player starter model is not warmed twice', () => {
    const figures = arrivalFigures({kind: 'monk', style: 'A'}, ['fit:monk', 'fit:smith'], modelFor);
    assert.deepEqual(figures.map(figure => figure.kind), ['monk', 'smith']);
});

test('a crowded road warms only the first few figures', () => {
    const people = Array.from({length: 30}, (_, index) => `fit:model-${index}`);
    assert.equal(arrivalFigures(null, people, modelFor).length, ARRIVAL_WARM_FIGURES);
    assert.equal(arrivalFigures({kind: 'self', style: 'A'}, people, modelFor).length, ARRIVAL_WARM_FIGURES);
});
