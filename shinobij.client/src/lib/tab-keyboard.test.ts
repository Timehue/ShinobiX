import assert from "node:assert/strict";
import test from "node:test";
import type { KeyboardEvent } from "react";
import { handleHorizontalTabKeyDown } from "./tab-keyboard";

function tabFixture(activeIndex: number, key: string) {
    const focused: number[] = [];
    const clicked: number[] = [];
    let prevented = false;
    const tabs = [0, 1, 2].map((index) => ({
        focus: () => focused.push(index),
        click: () => clicked.push(index),
        closest: () => ({ querySelectorAll: () => tabs }),
    }));
    const event = {
        key,
        currentTarget: tabs[activeIndex],
        preventDefault: () => { prevented = true; },
    } as unknown as KeyboardEvent<HTMLButtonElement>;
    return { event, focused, clicked, prevented: () => prevented };
}

test("horizontal tabs move focus and activation together", () => {
    const next = tabFixture(0, "ArrowRight");
    handleHorizontalTabKeyDown(next.event);
    assert.deepEqual(next.focused, [1]);
    assert.deepEqual(next.clicked, [1]);
    assert.equal(next.prevented(), true);

    const wrapped = tabFixture(0, "ArrowLeft");
    handleHorizontalTabKeyDown(wrapped.event);
    assert.deepEqual(wrapped.focused, [2]);
    assert.deepEqual(wrapped.clicked, [2]);
});

test("horizontal tabs support Home and End without consuming unrelated keys", () => {
    const home = tabFixture(2, "Home");
    handleHorizontalTabKeyDown(home.event);
    assert.deepEqual(home.clicked, [0]);

    const end = tabFixture(0, "End");
    handleHorizontalTabKeyDown(end.event);
    assert.deepEqual(end.clicked, [2]);

    const tab = tabFixture(1, "Tab");
    handleHorizontalTabKeyDown(tab.event);
    assert.deepEqual(tab.clicked, []);
    assert.equal(tab.prevented(), false);
});
