import type { VnCinematicDirection } from "../types/vn";
import {
    VN_AMBIENCES,
    VN_ATMOSPHERES,
    VN_ENTRANCES,
    VN_FOCUSES,
    VN_IMPACTS,
    VN_MOTIONS,
    VN_SHOTS,
    VN_TONES,
    VN_TRANSITIONS,
} from "../lib/vn-cinematic-authoring";

type DirectionKey = keyof VnCinematicDirection;

function title(value: string): string {
    return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function DirectionSelect({
    label,
    field,
    value,
    options,
    onChange,
}: {
    label: string;
    field: DirectionKey;
    value: string | undefined;
    options: readonly string[];
    onChange: (field: DirectionKey, value: string | boolean | undefined) => void;
}) {
    return (
        <label className="vn-direction-field">
            <span>{label}</span>
            <select value={value ?? ""} onChange={(event) => onChange(field, event.target.value || undefined)}>
                <option value="">Auto</option>
                {options.filter((option) => option !== "auto").map((option) => (
                    <option key={option} value={option}>{title(option)}</option>
                ))}
            </select>
        </label>
    );
}

export function VnCinematicDirectionEditor({
    value,
    onChange,
}: {
    value?: VnCinematicDirection;
    onChange: (value: VnCinematicDirection | undefined) => void;
}) {
    const update = (field: DirectionKey, next: string | boolean | undefined) => {
        const candidate = { ...(value ?? {}) } as Record<string, unknown>;
        if (next === undefined || next === "") delete candidate[field];
        else candidate[field] = next;
        onChange(Object.keys(candidate).length ? candidate as VnCinematicDirection : undefined);
    };

    return (
        <details className="vn-direction-editor">
            <summary>Cinematic direction</summary>
            <p className="hint">Auto is production-safe. Override only when the story beat needs a deliberate shot.</p>
            <div className="vn-direction-grid">
                <DirectionSelect label="Shot" field="shot" value={value?.shot} options={VN_SHOTS} onChange={update} />
                <DirectionSelect label="Focus" field="focus" value={value?.focus} options={VN_FOCUSES} onChange={update} />
                <DirectionSelect label="Camera" field="backgroundMotion" value={value?.backgroundMotion} options={VN_MOTIONS} onChange={update} />
                <DirectionSelect label="Transition" field="transition" value={value?.transition} options={VN_TRANSITIONS} onChange={update} />
                <DirectionSelect label="Tone" field="tone" value={value?.tone} options={VN_TONES} onChange={update} />
                <DirectionSelect label="Atmosphere" field="atmosphere" value={value?.atmosphere} options={VN_ATMOSPHERES} onChange={update} />
                <label className="vn-direction-field">
                    <span>Crop focal point</span>
                    <input
                        value={value?.backgroundPosition ?? ""}
                        placeholder="50% 50%"
                        onChange={(event) => update("backgroundPosition", event.target.value || undefined)}
                    />
                </label>
                <label className="vn-direction-field">
                    <span>Directed backdrop URL</span>
                    <input
                        value={value?.backgroundImage ?? ""}
                        placeholder="/scenes/story/..."
                        onChange={(event) => update("backgroundImage", event.target.value || undefined)}
                    />
                </label>
            </div>
            <details className="vn-direction-advanced">
                <summary>Advanced effects</summary>
                <div className="vn-direction-grid">
                    <DirectionSelect label="Actor entrance" field="actorEntrance" value={value?.actorEntrance} options={VN_ENTRANCES} onChange={update} />
                    <DirectionSelect label="Impact" field="impact" value={value?.impact} options={VN_IMPACTS} onChange={update} />
                    <DirectionSelect label="Ambience" field="ambience" value={value?.ambience} options={VN_AMBIENCES} onChange={update} />
                    <label className="vn-direction-field is-checkbox">
                        <input
                            type="checkbox"
                            checked={value?.titleCard ?? false}
                            onChange={(event) => update("titleCard", event.target.checked || undefined)}
                        />
                        <span>Force chapter title card</span>
                    </label>
                </div>
            </details>
        </details>
    );
}
