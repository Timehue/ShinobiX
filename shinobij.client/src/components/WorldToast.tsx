import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./WorldToast.css";

const AUTO_DISMISS_MS = 7000;

export function WorldToast({ text, kicker = "World update", icon, onClose }: {
    text: string;
    kicker?: string;
    icon?: ReactNode;
    onClose: () => void;
}) {
    const close = useRef(onClose);
    useLayoutEffect(() => { close.current = onClose; }, [onClose]);
    useEffect(() => {
        const timeout = setTimeout(() => close.current(), AUTO_DISMISS_MS);
        return () => clearTimeout(timeout);
    }, [text, kicker]);

    return createPortal(
        <div role="status" className="world-toast" aria-live="polite">
            {icon && <div aria-hidden="true">{icon}</div>}
            <div>
                <div>{kicker}</div>
                <div>{text}</div>
            </div>
            <button type="button" aria-label="Dismiss world update" onClick={event => { event.stopPropagation(); onClose(); }}>×</button>
        </div>,
        document.body,
    );
}
