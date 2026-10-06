import { createGamepadTextEntry } from "./gamepad-text-entry";

type Direction = 'up' | 'down' | 'left' | 'right';
type ControllerState = {
    confirm: boolean;
    cancel: boolean;
    direction: Direction | null;
    stickDirection: Direction | null;
    movement: { code: string; key: string } | null;
    attack: boolean;
    technique: boolean;
    jump: boolean;
    burst: boolean;
};

const ACTIONABLE = [
    'button:not(:disabled)',
    'a[href]',
    'summary',
    'input:not(:disabled):not([type="hidden"])',
    'select:not(:disabled)',
    'textarea:not(:disabled)',
    '[role="button"][tabindex]:not([aria-disabled="true"])',
    '[role="checkbox"][tabindex]:not([aria-disabled="true"])',
    '[role="link"][tabindex]:not([aria-disabled="true"])',
    '[role="option"][tabindex]:not([aria-disabled="true"])',
    '[role="radio"][tabindex]:not([aria-disabled="true"])',
    '[role="gridcell"][tabindex]:not([aria-disabled="true"])',
    '[role="slider"][tabindex]:not([aria-disabled="true"])',
    '[role="spinbutton"][tabindex]:not([aria-disabled="true"])',
    '[role="switch"][tabindex]:not([aria-disabled="true"])',
    '[role="tab"][tabindex]:not([aria-disabled="true"])',
    '[role="menuitem"][tabindex]:not([aria-disabled="true"])',
    '[role="treeitem"][tabindex]:not([aria-disabled="true"])',
].join(',');

const REPEAT_DELAY_MS = 220;
const ANALOG_DEAD_ZONE = 0.62;

function isTextEntry(element: Element | null): boolean {
    return element instanceof HTMLElement && (
        element.isContentEditable
        || element.matches('textarea, [role="textbox"], input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"], input[type="number"]')
    );
}

function setNativeControlValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

function stepSelect(select: HTMLSelectElement, direction: Direction): boolean {
    if (direction !== 'up' && direction !== 'down' && direction !== 'left' && direction !== 'right') return false;
    const step = direction === 'down' || direction === 'right' ? 1 : -1;
    for (let index = select.selectedIndex + step; index >= 0 && index < select.options.length; index += step) {
        const option = select.options[index];
        if (!option.disabled && !option.parentElement?.matches('optgroup:disabled')) {
            setNativeControlValue(select, option.value);
            return true;
        }
    }
    return true;
}

function stepNumericInput(input: HTMLInputElement, direction: Direction): boolean {
    if (input.type !== 'range' && input.type !== 'number') return false;
    if (input.type === 'range' && direction !== 'left' && direction !== 'right') return false;
    if (input.type === 'number' && direction !== 'up' && direction !== 'down') return false;

    const sign = direction === 'left' || direction === 'down' ? -1 : 1;
    const defaultMin = input.type === 'range' ? 0 : Number.NEGATIVE_INFINITY;
    const defaultMax = input.type === 'range' ? 100 : Number.POSITIVE_INFINITY;
    const parsedMin = input.min === '' ? defaultMin : Number(input.min);
    const parsedMax = input.max === '' ? defaultMax : Number(input.max);
    const min = Number.isFinite(parsedMin) ? parsedMin : defaultMin;
    const max = Number.isFinite(parsedMax) ? parsedMax : defaultMax;
    const step = input.step === '' || input.step === 'any' ? (input.type === 'range' ? (max - min) / 100 : 1) : Number(input.step);
    const current = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : Number.isFinite(min) ? min : 0;
    const next = Math.min(max, Math.max(min, current + sign * (Number.isFinite(step) && step > 0 ? step : 1)));
    if (next !== current) setNativeControlValue(input, String(next));
    return true;
}

function stepFocusedControl(direction: Direction): boolean {
    const active = document.activeElement;
    if (active instanceof HTMLSelectElement) {
        if (active.dataset.gamepadHorizontalSelect === 'true') {
            return direction === 'left' || direction === 'right' ? stepSelect(active, direction) : false;
        }
        return stepSelect(active, direction);
    }
    if (active instanceof HTMLInputElement) return stepNumericInput(active, direction);
    return false;
}

function isVisibleOnScreen(element: HTMLElement): boolean {
    if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2 && rect.bottom > 0 && rect.right > 0
        && rect.top < innerHeight && rect.left < innerWidth;
}

function isNavigable(element: HTMLElement): boolean {
    if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
            || Number(style.opacity) === 0) return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
}

function activeModal(): HTMLElement | null {
    // Modal portals are normally appended after the app root. Prefer the last
    // visible modal so nested dialogs keep navigation in the topmost layer.
    return [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')]
        .filter(isVisibleOnScreen)
        .at(-1) ?? null;
}

function navigationCandidates(modal = activeModal()): HTMLElement[] {
    const scope: ParentNode = modal ?? document;
    return [...scope.querySelectorAll<HTMLElement>(ACTIONABLE)].filter(element => {
        if (element.tabIndex < 0
            || element.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]')) return false;
        // Offscreen controls stay eligible: D-pad navigation can focus them
        // and scroll them into view on long pages and inside scrollable panels.
        return isNavigable(element);
    });
}

function centerOf(element: HTMLElement): { x: number; y: number } {
    const controlRect = element.getBoundingClientRect();
    // A native checkbox or radio is often visually compact inside a much
    // larger label target. Navigate by the target's full hit area, or D-pad
    // movement can skip it for a lower control that happens to align with the
    // tiny input itself.
    const label = element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')
        ? element.labels?.item(0)
        : null;
    const labelRect = label?.getBoundingClientRect();
    const rect = labelRect && labelRect.width >= controlRect.width + 64 ? labelRect : controlRect;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function dispatchKey(code: string, key: string, type: 'keydown' | 'keyup', target: HTMLElement = document.body): KeyboardEvent {
    const event = new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
}

function tapKey(code: string, key: string): void {
    dispatchKey(code, key, 'keydown');
    dispatchKey(code, key, 'keyup');
}

function dispatchEscape(): void {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    dispatchKey('Escape', 'Escape', 'keydown', target);
}

function releaseHeldControllerKeys(states: Map<number, ControllerState>): void {
    for (const [index, state] of states) {
        if (state.movement) dispatchKey(state.movement.code, state.movement.key, 'keyup');
        if (state.burst) dispatchKey('ShiftLeft', 'Shift', 'keyup');
        if (state.movement || state.burst) states.set(index, { ...state, movement: null, burst: false });
    }
}

function isPressed(gamepad: Gamepad, index: number): boolean {
    return gamepad.buttons[index]?.pressed === true;
}

function keyForMovement(mode: string | undefined, direction: Direction | null): { code: string; key: string } | null {
    if (mode === 'sector') {
        switch (direction) {
            case 'up': return { code: 'KeyW', key: 'w' };
            case 'left': return { code: 'KeyA', key: 'a' };
            case 'down': return { code: 'KeyS', key: 's' };
            case 'right': return { code: 'KeyD', key: 'd' };
            default: return null;
        }
    }
    if (mode === 'rally') {
        if (direction === 'left') return { code: 'ArrowLeft', key: 'ArrowLeft' };
        if (direction === 'right') return { code: 'ArrowRight', key: 'ArrowRight' };
    }
    return null;
}

function moveFocus(direction: Direction): void {
    const candidates = navigationCandidates();
    if (!candidates.length) return;

    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const origin = active && candidates.includes(active)
        ? centerOf(active)
        : { x: innerWidth / 2, y: innerHeight / 2 };

    let best: HTMLElement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestFallback: HTMLElement | null = null;
    let bestFallbackScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        if (candidate === active) continue;
        const point = centerOf(candidate);
        const dx = point.x - origin.x;
        const dy = point.y - origin.y;
        const primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
        const cross = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
        const score = primary + cross * 1.65;

        if (primary > 4 && score < bestScore) {
            best = candidate;
            bestScore = score;
        }
        // If the current panel ends here, wrap to the closest control on the
        // opposite edge while staying in roughly the same row or column.
        const fallback = -primary + cross * 2.8;
        if (fallback > 4 && fallback < bestFallbackScore) {
            bestFallback = candidate;
            bestFallbackScore = fallback;
        }
    }

    const target = best ?? bestFallback;
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}

function dispatchFocusedArrow(direction: Direction): boolean {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!active || isTextEntry(active) || !active.closest('[data-gamepad-arrow-keys="true"]')) return false;
    const key = direction === 'left' ? 'ArrowLeft'
        : direction === 'right' ? 'ArrowRight'
            : direction === 'up' ? 'ArrowUp' : 'ArrowDown';
    const before = document.activeElement;
    const event = dispatchKey(key, key, 'keydown', active);
    dispatchKey(key, key, 'keyup', active);
    // A custom menu can consume the arrow at its own boundary or move focus
    // according to its grid semantics. In either case, don't also apply the
    // generic geometric focus step.
    return event.defaultPrevented || document.activeElement !== before;
}

/**
 * Adds controller navigation and contextual controls for keyboard-driven game
 * modes. Mouse, touch, keyboard, and text editing keep their normal behavior;
 * no RAF loop runs when no controller is connected.
 */
export function installGamepadNavigation(): () => void {
    if (typeof window === 'undefined' || typeof navigator.getGamepads !== 'function') return () => {};

    const lastPressed = new Map<number, ControllerState>();
    const textEntry = createGamepadTextEntry();
    let frame = 0;
    let lastNavigationAt = 0;
    let lastMovementAt = 0;
    let active = false;

    const setConnectedState = (connected: boolean) => {
        const root = document.documentElement;
        if (connected) {
            if (root.dataset.gamepadConnected !== 'true') root.dataset.gamepadConnected = 'true';
        } else if (root.dataset.gamepadConnected === 'true') {
            delete root.dataset.gamepadConnected;
        }
    };

    const readGamepads = () => {
        try { return navigator.getGamepads(); }
        catch { return []; } // Privacy denial sleeps polling until focus/connection retries.
    };
    const hasStandardGamepad = () =>
        readGamepads().some(gamepad => gamepad?.connected && gamepad.mapping === 'standard');

    const syncConnection = () => {
        const connected = hasStandardGamepad();
        setConnectedState(connected);
        if (connected && !active) {
            active = true;
            lastPressed.clear();
            frame = requestAnimationFrame(poll);
        } else if (!connected && active) {
            active = false;
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            releaseHeldControllerKeys(lastPressed);
            lastPressed.clear();
        }
    };

    function poll(now: number) {
        if (!active) return;
        if (document.visibilityState !== 'visible') {
            frame = requestAnimationFrame(poll);
            return;
        }
        let anyConnected = false;
        for (const gamepad of readGamepads()) {
            if (!gamepad?.connected || gamepad.mapping !== 'standard') continue;
            anyConnected = true;
            const modal = activeModal();
            const focused = document.activeElement;
            if (modal && (!(focused instanceof HTMLElement) || !modal.contains(focused))) {
                // Immersive visual-novel scenes use the focused stage itself
                // for the keyboard's Enter/Space advance action. Start there
                // so controller confirm reveals dialogue instead of changing
                // a header setting before the player has begun reading.
                const sceneStage = modal.matches('[data-gamepad-mode="visual-novel"]')
                    ? modal
                    : modal.querySelector<HTMLElement>('[data-gamepad-mode="visual-novel"]');
                (sceneStage ?? navigationCandidates(modal)[0])?.focus({ preventScroll: true });
            }

            const previous = lastPressed.get(gamepad.index) ?? {
                confirm: false, cancel: false, direction: null, stickDirection: null,
                movement: null,
                attack: false, technique: false, jump: false, burst: false,
            };
            const mode = (modal?.matches('[data-gamepad-mode]') ? modal
                : modal?.querySelector<HTMLElement>('[data-gamepad-mode]')
                    ?? (modal ? null : document.querySelector<HTMLElement>('[data-gamepad-mode]')))?.dataset.gamepadMode;
            const confirm = isPressed(gamepad, 0);
            if (confirm && !previous.confirm) {
                const target = document.activeElement;
                if (target instanceof HTMLElement && isTextEntry(target)) {
                    textEntry.open(target);
                } else if (mode === 'visual-novel' && target instanceof HTMLElement && modal?.contains(target)
                    && !target.matches(ACTIONABLE)) {
                    // The focused novel stage already owns the canonical
                    // Enter behavior: reveal the current line or advance it.
                    dispatchKey('Enter', 'Enter', 'keydown', target);
                    dispatchKey('Enter', 'Enter', 'keyup', target);
                } else if (target instanceof HTMLElement && target.matches(ACTIONABLE)
                    && (!modal || modal.contains(target)) && isVisibleOnScreen(target)) {
                    target.click();
                }
            }
            // Standard gamepad B is the universal back/cancel action. Reuse
            // each screen's established Escape policy so nested dialogs close
            // in the same order as keyboard use, without inventing a second
            // navigation state machine.
            const cancel = isPressed(gamepad, 1);
            if (cancel && !previous.cancel && !isTextEntry(document.activeElement)) dispatchEscape();

            const x = gamepad.axes[0] ?? 0;
            const y = gamepad.axes[1] ?? 0;
            const stickDirection: Direction | null = Math.abs(x) > Math.abs(y) && Math.abs(x) >= ANALOG_DEAD_ZONE
                ? (x < 0 ? 'left' : 'right')
                : Math.abs(y) >= ANALOG_DEAD_ZONE ? (y < 0 ? 'up' : 'down') : null;
            const padDirection: Direction | null = isPressed(gamepad, 14) ? 'left'
                : isPressed(gamepad, 15) ? 'right'
                    : isPressed(gamepad, 12) ? 'up'
                        : isPressed(gamepad, 13) ? 'down' : null;
            const direction = padDirection ?? (mode === 'sector' || mode === 'rally' ? null : stickDirection);
            const movement = !isTextEntry(document.activeElement) ? keyForMovement(mode, stickDirection) : null;
            const movementChanged = movement?.code !== previous.movement?.code;
            if (previous.movement && movementChanged) {
                dispatchKey(previous.movement.code, previous.movement.key, 'keyup');
            }
            const movementEdge = movement !== null && movementChanged;
            const movementRepeat = movement !== null && !movementChanged && now - lastMovementAt >= REPEAT_DELAY_MS;
            if (movement && (movementEdge || movementRepeat) && !isTextEntry(document.activeElement)) {
                dispatchKey(movement.code, movement.key, 'keydown');
                lastMovementAt = now;
            }

            const directionEdge = direction !== null && direction !== previous.direction;
            const directionRepeat = direction !== null && direction === previous.direction && now - lastNavigationAt >= REPEAT_DELAY_MS;
            if (directionEdge || directionRepeat) {
                if (!stepFocusedControl(direction!) && !dispatchFocusedArrow(direction!)) moveFocus(direction!);
                lastNavigationAt = now;
            }

            const attack = mode === 'rally' && isPressed(gamepad, 2);
            const technique = mode === 'rally' && isPressed(gamepad, 3);
            const jump = mode === 'rally' && isPressed(gamepad, 7);
            const burst = mode === 'rally' && isPressed(gamepad, 6);
            if (attack && !previous.attack) tapKey('KeyQ', 'q');
            if (technique && !previous.technique) tapKey('KeyE', 'e');
            if (jump && !previous.jump) tapKey('Space', ' ');
            if (burst !== previous.burst) dispatchKey('ShiftLeft', 'Shift', burst ? 'keydown' : 'keyup');
            lastPressed.set(gamepad.index, { confirm, cancel, direction, stickDirection, movement, attack, technique, jump, burst });
        }

        if (!anyConnected) {
            releaseHeldControllerKeys(lastPressed);
            lastPressed.clear();
            active = false;
            frame = 0;
            setConnectedState(false);
            return;
        }
        setConnectedState(true);
        frame = requestAnimationFrame(poll);
    }

    const onConnected = (event: GamepadEvent) => {
        if (event.gamepad.mapping === 'standard') syncConnection();
    };
    const onDisconnected = (event: GamepadEvent) => {
        // Another connected pad keeps polling alive, so release the removed
        // pad's held keys before dropping its per-controller edge state.
        const index = event.gamepad?.index;
        const state = index !== undefined ? lastPressed.get(index) : undefined;
        if (index !== undefined && state) {
            releaseHeldControllerKeys(new Map([[index, state]]));
            lastPressed.delete(index);
        }
        syncConnection();
    };
    const onVisibilityChange = () => {
        if (document.visibilityState !== 'visible') {
            releaseHeldControllerKeys(lastPressed);
            return;
        }
        syncConnection();
    };

    window.addEventListener('gamepadconnected', onConnected);
    window.addEventListener('gamepaddisconnected', onDisconnected);
    window.addEventListener('focus', syncConnection);
    document.addEventListener('visibilitychange', onVisibilityChange);
    syncConnection();
    return () => {
        active = false;
        if (frame) cancelAnimationFrame(frame);
        releaseHeldControllerKeys(lastPressed);
        textEntry.close();
        window.removeEventListener('gamepadconnected', onConnected);
        window.removeEventListener('gamepaddisconnected', onDisconnected);
        window.removeEventListener('focus', syncConnection);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        setConnectedState(false);
        lastPressed.clear();
    };
}
