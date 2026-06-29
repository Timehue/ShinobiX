/*
 * VnDialogueEditor — a structured, per-line editor for visual-novel dialogue.
 *
 * It reads and writes the SAME "Speaker: text" newline-joined string the VN
 * renderers and the save path already use (via parse/serializeDialogueLines),
 * so storage and playback are completely unchanged — this is purely an
 * authoring upgrade over the raw textarea. Each row is a speaker field (with a
 * datalist of the page's cast) plus the line text, and rows can be added,
 * removed, and reordered. Stateless: the lines are derived from `value` on every
 * render and every edit serializes straight back through `onChange`, so there's
 * no draft state to drift out of sync with the raw-text escape hatch.
 */
import { parseDialogueString, serializeDialogueLines, type DialogueLine } from "../lib/vn";

export function VnDialogueEditor({ value, onChange, cast, idBase }: {
    value: string;
    onChange: (next: string) => void;
    cast: string[];
    idBase: string;
}) {
    const lines = parseDialogueString(value);
    const listId = `${idBase}-cast`;
    const castNames = Array.from(
        new Set([...cast, "Narrator", "Player"].map((n) => (n ?? "").trim()).filter(Boolean)),
    );
    const emit = (next: DialogueLine[]) => onChange(serializeDialogueLines(next));
    const swap = (i: number, j: number) => {
        if (j < 0 || j >= lines.length) return;
        const next = lines.slice();
        [next[i], next[j]] = [next[j], next[i]];
        emit(next);
    };

    return (
        <div className="vn-dialogue-editor">
            <datalist id={listId}>{castNames.map((n) => <option key={n} value={n} />)}</datalist>
            {lines.map((line, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(84px, 124px) 1fr auto", gap: 6, marginBottom: 4 }}>
                    <input
                        list={listId}
                        placeholder="Speaker"
                        aria-label={`Line ${i + 1} speaker`}
                        value={line.speaker}
                        onChange={(e) => emit(lines.map((l, j) => j === i ? { ...l, speaker: e.target.value } : l))}
                    />
                    <input
                        placeholder="Line text…"
                        aria-label={`Line ${i + 1} text`}
                        value={line.text}
                        onChange={(e) => emit(lines.map((l, j) => j === i ? { ...l, text: e.target.value } : l))}
                    />
                    <span style={{ display: "inline-flex", gap: 2 }}>
                        <button type="button" title="Move up" disabled={i === 0} onClick={() => swap(i, i - 1)}>↑</button>
                        <button type="button" title="Move down" disabled={i === lines.length - 1} onClick={() => swap(i, i + 1)}>↓</button>
                        <button type="button" className="danger-button" title="Remove line" onClick={() => emit(lines.filter((_, j) => j !== i))}>🗑️</button>
                    </span>
                </div>
            ))}
            <button type="button" onClick={() => emit([...lines, { speaker: "", text: "" }])}>+ Add line</button>
        </div>
    );
}
