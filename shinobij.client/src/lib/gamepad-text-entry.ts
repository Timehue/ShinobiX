type TextEntryTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
type TextRange = { start: number; end: number };

const LETTER_ROWS = [
    [..."qwertyuiop"],
    [..."asdfghjkl"],
    [..."zxcvbnm"],
] as const;

function supportsTextEntry(element: HTMLElement): element is TextEntryTarget {
    return element instanceof HTMLInputElement
        || element instanceof HTMLTextAreaElement
        || element.isContentEditable;
}

function inputMode(element: TextEntryTarget): string {
    return element instanceof HTMLInputElement ? `${element.type} ${element.inputMode}`.toLowerCase()
        : element instanceof HTMLTextAreaElement ? element.inputMode.toLowerCase()
            : "text";
}

function numericEntry(element: TextEntryTarget): boolean {
    return /(^|\s)(number|tel|numeric|decimal)(\s|$)/.test(inputMode(element));
}

function fieldLabel(element: TextEntryTarget): string {
    const explicit = element.getAttribute("aria-label")?.trim();
    if (explicit) return explicit;
    if (element instanceof HTMLInputElement && element.labels?.length) {
        const label = [...element.labels].map(item => item.textContent?.trim()).filter(Boolean).join(" ");
        if (label) return label;
    }
    const placeholder = element.getAttribute("placeholder")?.trim();
    return placeholder || "Text field";
}

function currentRange(element: TextEntryTarget, valueLength: number): TextRange {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        try {
            const start = element.selectionStart;
            const end = element.selectionEnd;
            if (start !== null && end !== null) return { start, end };
        } catch {
            // Number inputs do not expose text selection in all browsers.
        }
    }
    if (element.isContentEditable) {
        const selection = window.getSelection();
        const selected = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (selected && element.contains(selected.startContainer) && element.contains(selected.endContainer)) {
            const offsetOf = (node: Node, offset: number) => {
                const prefix = document.createRange();
                prefix.selectNodeContents(element);
                prefix.setEnd(node, offset);
                return prefix.toString().length;
            };
            return {
                start: offsetOf(selected.startContainer, selected.startOffset),
                end: offsetOf(selected.endContainer, selected.endOffset),
            };
        }
    }
    return { start: valueLength, end: valueLength };
}

function readText(element: TextEntryTarget): string {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
    return element.textContent ?? "";
}

function setNativeText(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return;
    setter.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

function editablePointAt(element: HTMLElement, offset: number): { node: Node; offset: number } | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) nodes.push(node as Text);
    let remaining = offset;
    for (const textNode of nodes) {
        if (remaining <= textNode.length) return { node: textNode, offset: remaining };
        remaining -= textNode.length;
    }
    if (!nodes.length) return { node: element, offset: 0 };
    const last = nodes.at(-1)!;
    return { node: last, offset: last.length };
}

function restoreEditableCaret(element: HTMLElement, offset: number): void {
    const point = editablePointAt(element, offset);
    if (!point) return;
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function replaceText(element: TextEntryTarget, value: string, range: TextRange): TextRange {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const previous = element.value;
        const start = Math.max(0, Math.min(previous.length, range.start));
        const end = Math.max(start, Math.min(previous.length, range.end));
        const maxLength = element.maxLength;
        const accepted = maxLength >= 0 ? value.slice(0, Math.max(0, maxLength - (previous.length - (end - start)))) : value;
        const next = previous.slice(0, start) + accepted + previous.slice(end);
        const caret = start + accepted.length;
        if (next !== previous) setNativeText(element, next);
        if (element.type !== "number") {
            try { element.setSelectionRange(caret, caret); } catch { /* Some browser input types reject caret selection. */ }
        }
        return { start: caret, end: caret };
    }

    const text = element.textContent ?? "";
    const start = Math.max(0, Math.min(text.length, range.start));
    const end = Math.max(start, Math.min(text.length, range.end));
    const selection = window.getSelection();
    if (!selection) return { start, end };
    const from = editablePointAt(element, start);
    const to = editablePointAt(element, end);
    if (!from || !to) return { start, end };
    const selectionRange = document.createRange();
    selectionRange.setStart(from.node, from.offset);
    selectionRange.setEnd(to.node, to.offset);
    selectionRange.deleteContents();
    const inserted = document.createTextNode(value);
    selectionRange.insertNode(inserted);
    selectionRange.setStartAfter(inserted);
    selectionRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(selectionRange);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return { start: start + value.length, end: start + value.length };
}

function deleteBackward(element: TextEntryTarget, range: TextRange): TextRange {
    const text = readText(element);
    if (range.start !== range.end) return replaceText(element, "", range);
    if (range.start <= 0) return range;
    let start = range.start - 1;
    // Keep a surrogate pair together when deleting emoji already in the field.
    const code = text.charCodeAt(start);
    if (code >= 0xdc00 && code <= 0xdfff && start > 0) start--;
    return replaceText(element, "", { start, end: range.end });
}

function createButton(label: string, accessibleLabel: string, action: () => void, className = ""): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `gamepad-text-entry-key${className ? ` ${className}` : ""}`;
    button.textContent = label;
    button.setAttribute("aria-label", accessibleLabel);
    button.addEventListener("click", action);
    return button;
}

export function createGamepadTextEntry() {
    let scrim: HTMLDivElement | null = null;
    let target: TextEntryTarget | null = null;
    let range: TextRange = { start: 0, end: 0 };
    let shifted = false;

    const close = () => {
        const previousTarget = target;
        const previousRange = range;
        scrim?.remove();
        scrim = null;
        target = null;
        shifted = false;
        if (!previousTarget?.isConnected) return;
        previousTarget.focus({ preventScroll: true });
        if (previousTarget instanceof HTMLInputElement || previousTarget instanceof HTMLTextAreaElement) {
            try { previousTarget.setSelectionRange(previousRange.end, previousRange.end); } catch { /* Numeric fields have no caret API. */ }
        } else restoreEditableCaret(previousTarget, previousRange.end);
    };

    const open = (element: HTMLElement): boolean => {
        if (!supportsTextEntry(element)) return false;
        if (scrim) close();
        target = element;
        range = currentRange(element, readText(element).length);
        shifted = false;

        const backdrop = document.createElement("div");
        backdrop.className = "gamepad-text-entry-scrim";
        backdrop.dataset.gamepadTextEntry = "true";
        const dialog = document.createElement("section");
        dialog.className = "gamepad-text-entry-panel";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-label", `On-screen keyboard for ${fieldLabel(element)}`);

        const heading = document.createElement("div");
        heading.className = "gamepad-text-entry-heading";
        const title = document.createElement("div");
        title.className = "gamepad-text-entry-title";
        title.textContent = fieldLabel(element);
        const hint = document.createElement("div");
        hint.className = "gamepad-text-entry-hint";
        hint.textContent = "D-pad to choose · A to enter · B to return";
        const closeButton = createButton("Done", "Finish text entry", close, "is-primary gamepad-text-entry-done");
        heading.append(title, hint, closeButton);

        const preview = document.createElement("output");
        preview.className = "gamepad-text-entry-preview";
        preview.setAttribute("aria-label", "Current text entry");
        preview.setAttribute("aria-live", "polite");
        const keyRows = document.createElement("div");
        keyRows.className = "gamepad-text-entry-rows";
        const updatePreview = () => {
            if (!target) return;
            const text = readText(target);
            preview.textContent = target instanceof HTMLInputElement && target.type === "password"
                ? "•".repeat(text.length)
                : text || " ";
        };
        const refreshLetterCase = () => {
            keyRows.querySelectorAll<HTMLButtonElement>("[data-gamepad-text-key]").forEach(button => {
                const key = button.dataset.gamepadTextKey ?? "";
                button.textContent = shifted ? key.toUpperCase() : key;
                button.setAttribute("aria-label", `Enter ${shifted ? key.toUpperCase() : key}`);
            });
        };
        const insert = (value: string) => {
            if (!target) return;
            range = replaceText(target, value, range);
            if (shifted && value.length === 1) {
                shifted = false;
                refreshLetterCase();
            }
            updatePreview();
        };
        const backspace = () => { if (target) { range = deleteBackward(target, range); updatePreview(); } };
        const clearText = () => {
            if (!target) return;
            range = replaceText(target, "", { start: 0, end: readText(target).length });
            updatePreview();
        };
        updatePreview();

        const appendRow = (labels: Array<{ label: string; value?: string; action?: () => void; kind?: string }>, rowClass = "") => {
            const row = document.createElement("div");
            row.className = `gamepad-text-entry-row${rowClass ? ` ${rowClass}` : ""}`;
            for (const item of labels) {
                const action = item.action ?? (() => insert(shifted ? item.value!.toUpperCase() : item.value!));
                const accessibleLabel = item.value === "\n" ? "New line"
                    : item.value === " " ? "Space"
                        : item.value ? `Enter ${item.label}` : item.label;
                const button = createButton(item.label, accessibleLabel, action, item.kind ?? "");
                if (item.value) button.dataset.gamepadTextKey = item.value;
                row.append(button);
            }
            keyRows.append(row);
        };

        if (numericEntry(element)) {
            for (const digits of [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]]) {
                appendRow(digits.map(digit => ({ label: digit, value: digit })));
            }
            const isTelephone = inputMode(element).includes("tel");
            const numericLast = (isTelephone ? ["+", "0", "*", "#", "⌫", "Clear"] : ["0", ".", "⌫", "Clear"]).map(key => ({
                label: key,
                value: /^(?:[0-9.+*#])$/.test(key) && (isTelephone || /^(?:[0-9.]|\+)$/.test(key)) ? key : undefined,
                action: key === "⌫" ? backspace
                    : key === "Clear" ? clearText
                        : undefined,
                kind: key === "Clear" || key === "⌫" ? "is-utility" : "",
            }));
            appendRow(numericLast, "is-numeric-row");
        } else {
            LETTER_ROWS.forEach((letters, rowIndex) => {
                const items: Array<{ label: string; value?: string; action?: () => void; kind?: string }> = letters.map(letter => ({
                    label: shifted ? letter.toUpperCase() : letter,
                    value: letter,
                }));
                if (rowIndex === 2) {
                    items.unshift({ label: "⇧", action: () => {
                        shifted = !shifted;
                        refreshLetterCase();
                    }, kind: "is-utility" });
                    items.push({ label: "⌫", action: backspace, kind: "is-utility" });
                }
                appendRow(items, rowIndex === 1 ? "is-inset-row" : "");
            });
            const type = inputMode(element);
            const punctuation = type.includes("email")
                ? ["@", ".", "-", "_"]
                : type.includes("url")
                    ? ["@", ".", "-", "_", "/", ":"]
                    : ["@", ".", ",", "'", "-", "?"];
            appendRow([
                ...punctuation.map(value => ({ label: value, value })),
                ...(element instanceof HTMLTextAreaElement ? [{ label: "↵", value: "\n", kind: "is-utility" }] : []),
                ...((element instanceof HTMLTextAreaElement || !/email|url/.test(type))
                    ? [{ label: "Space", value: " ", kind: "is-wide" }]
                    : []),
                { label: "Clear", action: clearText, kind: "is-utility" },
            ], "is-symbol-row");
        }

        backdrop.append(dialog);
        dialog.append(heading, preview, keyRows);
        dialog.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
            }
            if (event.key !== "Tab") return;
            const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
            if (!buttons.length) return;
            const first = buttons[0];
            const last = buttons.at(-1)!;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) close();
        });
        document.body.append(backdrop);
        scrim = backdrop;
        dialog.querySelector<HTMLButtonElement>("[data-gamepad-text-key]")?.focus({ preventScroll: true });
        return true;
    };

    return { open, close };
}
