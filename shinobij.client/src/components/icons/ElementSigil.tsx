import type { CSSProperties, ReactElement } from "react";

const ELEMENT_TONES: Record<string, string> = {
    water: "#66b9ff",
    wind: "#36e0bb",
    earth: "#e2ad60",
    lightning: "#f6db54",
    fire: "#ff7a68",
};

const ELEMENT_MARKS: Record<string, ReactElement> = {
    water: (
        <>
            <path d="M16 6.4c-1.9 3.1-5.3 6.7-5.3 10.3a5.3 5.3 0 0 0 10.6 0c0-3.6-3.4-7.2-5.3-10.3Z" />
            <path d="M8.4 20.8c2.2-1.2 4.1-1.2 6.2 0s4 1.2 6.8-.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </>
    ),
    wind: (
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7.1 12.1h10.7c3.4 0 3.7-4.7.5-5.2-1.6-.3-2.7.5-3.2 1.7" />
            <path d="M6.2 16h13.2c3.2 0 3.4 4.5.4 5-1.6.2-2.7-.5-3.2-1.7" />
            <path d="M8.1 19.7h4.6" opacity=".68" />
        </g>
    ),
    earth: (
        <>
            <path d="m6.6 21.4 6.8-13.2 3.1 5.1 2-2.9 6.9 11H6.6Z" />
            <path d="m13.4 8.2 1.2 7.1 1.9-2 1.4 8.1" fill="none" stroke="rgba(3,8,17,.72)" strokeWidth="1.3" strokeLinejoin="round" />
        </>
    ),
    lightning: (
        <path d="M18.1 5.7 9.2 17h5.2l-1 9.1 9.3-12.3h-5.2l.6-8.1Z" />
    ),
    fire: (
        <path fillRule="evenodd" clipRule="evenodd" d="M17.7 5.2c.5 4-2.1 5.2-1.8 8.1.1 1.1.8 1.8 1.7 2.5-.1-1.9.9-3.6 2.5-4.9 1.8 2.3 3.1 4.7 3.1 7.4a7.2 7.2 0 0 1-14.4 0c0-4.5 3-8.7 8.9-13.1Zm-1.6 11.2c-1.6 1.4-2.4 2.7-2.4 4a2.4 2.4 0 0 0 4.8 0c0-1.1-.7-2.4-2.4-4Z" />
    ),
    unknown: (
        <path d="m16 6.3 2.1 6.5 6.8 2.1-6.8 2.2-2.1 6.6-2.1-6.6-6.8-2.2 6.8-2.1L16 6.3Z" />
    ),
};

export function ElementSigil({
    element,
    size = 32,
    title,
    className,
}: {
    element?: string;
    size?: number | string;
    title?: string;
    className?: string;
}) {
    const key = element?.trim().toLowerCase() ?? "unknown";
    const mark = ELEMENT_MARKS[key] ?? ELEMENT_MARKS.unknown;
    const style = {
        width: size,
        height: size,
        color: ELEMENT_TONES[key] ?? "#dcc98d",
    } as CSSProperties;

    return (
        <span
            className={`element-sigil${className ? ` ${className}` : ""}`}
            style={style}
            role={title ? "img" : undefined}
            aria-label={title}
            aria-hidden={title ? undefined : true}
        >
            <svg viewBox="0 0 32 32" focusable="false">
                <path className="element-sigil-crest" d="m16 1.7 4.2 5.6 6.9-1.1-1.1 6.9 5.6 4.2-5.6 4.2 1.1 6.9-6.9-1.1-4.2 5.6-4.2-5.6-6.9 1.1 1.1-6.9-5.6-4.2 5.6-4.2-1.1-6.9 6.9 1.1L16 1.7Z" />
                <circle className="element-sigil-disc" cx="16" cy="16" r="11.2" />
                <circle className="element-sigil-ring" cx="16" cy="16" r="9.3" />
                <g className="element-sigil-mark">{mark}</g>
            </svg>
        </span>
    );
}
