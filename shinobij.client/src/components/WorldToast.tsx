import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

const AUTO_DISMISS_MS = 7000;

export function WorldToast({ text, kicker = "World update", icon, onClose }: {
    text: string;
    kicker?: string;
    icon?: ReactNode;
    onClose: () => void;
}) {
    useEffect(() => {
        const timeout = setTimeout(onClose, AUTO_DISMISS_MS);
        return () => clearTimeout(timeout);
    }, [onClose]);

    return createPortal(
        <div
            role="status"
            onClick={onClose}
            style={{
                position: "fixed",
                left: "50%",
                bottom: 24,
                transform: "translateX(-50%)",
                zIndex: 3000,
                maxWidth: "min(460px, calc(100vw - 28px))",
                display: "flex",
                gap: 12,
                alignItems: "center",
                cursor: "pointer",
                padding: "12px 16px",
                borderRadius: 8,
                background: "linear-gradient(160deg, rgba(17,24,39,.97), rgba(2,6,23,.97))",
                border: "1px solid rgba(250,204,21,.52)",
                boxShadow: "0 8px 30px rgba(0,0,0,.55), 0 0 24px rgba(250,204,21,.2)",
                animation: "world-toast-in .34s ease-out",
            }}
        >
            {icon && (
                <div
                    aria-hidden="true"
                    style={{
                        width: 42,
                        height: 42,
                        display: "grid",
                        placeItems: "center",
                        borderRadius: "50%",
                        color: "#fde68a",
                        background: "rgba(120,53,15,.55)",
                        border: "1px solid rgba(250,204,21,.45)",
                        flexShrink: 0,
                    }}
                >
                    {icon}
                </div>
            )}
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: ".72rem", letterSpacing: 0, textTransform: "uppercase", color: "#fde68a", fontWeight: 800, marginBottom: 2 }}>
                    {kicker}
                </div>
                <div style={{ fontSize: ".82rem", color: "#e2e8f0", lineHeight: 1.45 }}>
                    {text}
                </div>
            </div>
            <style>{`@keyframes world-toast-in { from { opacity: 0; transform: translateX(-50%) translateY(14px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }`}</style>
        </div>,
        document.body,
    );
}
