import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRST_CONTRACT_OPEN, FIRST_CONTRACT_OPEN_WINDOW_MS, claimFirstContractOpen, openFirstContract } from './first-contract';

function withWindow(run: (target: EventTarget) => void): void {
    const originalWindow = globalThis.window;
    const target = new EventTarget();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
    try {
        run(target);
    } finally {
        claimFirstContractOpen();
        if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
        else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    }
}

test('a listening host claims the open while it is dispatched, leaving nothing to replay', () => {
    withWindow((target) => {
        const claims: boolean[] = [];
        target.addEventListener(FIRST_CONTRACT_OPEN, () => { claims.push(claimFirstContractOpen()); });
        openFirstContract();
        assert.deepEqual(claims, [true]);
        assert.equal(claimFirstContractOpen(), false, 'a host mounting later must not open the journal again');
    });
});

test('an open that arrives before the host listens waits for the host to mount, once', () => {
    withWindow(() => {
        assert.equal(claimFirstContractOpen(), false, 'no click, no open');
        openFirstContract();
        assert.equal(claimFirstContractOpen(), true, 'the mounting host answers the early click');
        assert.equal(claimFirstContractOpen(), false, 'a claim is single-use');
    });
});

test('an unclaimed open expires, so an old click cannot open the journal on its own', () => {
    withWindow(() => {
        openFirstContract();
        const clickedBy = performance.now();
        assert.equal(claimFirstContractOpen(clickedBy + FIRST_CONTRACT_OPEN_WINDOW_MS + 1), false);
        assert.equal(claimFirstContractOpen(), false, 'an expired open is discarded, not kept');
        openFirstContract();
        assert.equal(claimFirstContractOpen(performance.now() + FIRST_CONTRACT_OPEN_WINDOW_MS / 2), true);
    });
});
