import { Activity, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { clearRecoveryAdminSession, setRecoveryAdminSession } from "../authFetch";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import type { AdminRole } from "../types/core";
import { PlayerSurfaceBlocker, type PlayerSurfaceBlockerMode } from "./PlayerSurfaceBlocker";
import { ScreenLoadingFallback } from "./ScreenLoadingFallback";

const OperatorAdminLogin = lazyWithRetry(() => import("../screens/AdminLogin").then((module) => ({ default: module.AdminLogin })));
const OperatorDiagnostics = lazyWithRetry(() => import("../screens/AdminDiagnosticsPanel").then((module) => ({ default: module.AdminDiagnosticsPanel })));

/**
 * Keeps the complete player tree mounted and inert while the separately
 * authenticated operator console remains interactive in the modal top layer.
 * The console retains its explicit, server-guarded recovery actions but does
 * not mount AdminPanel: that broad editor owns player/admin save state and its
 * Save action is not safe to share with a paused player's save authority.
 */
export function MaintenanceOperatorBoundary({
    mode,
    children,
}: {
    mode: PlayerSurfaceBlockerMode | null;
    children: ReactNode;
}) {
    const [operatorView, setOperatorView] = useState<"login" | "diagnostics" | null>(null);
    const [adminPassword, setAdminPassword] = useState("");
    const recoveryAdminSessionRef = useRef(false);
    const operatorRecoveryOpen = operatorView !== null;
    const playerSurfaceBlocked = mode !== null || operatorRecoveryOpen;

    const closeOperatorRecovery = useCallback(() => {
        setOperatorView(null);
        setAdminPassword("");
        if (recoveryAdminSessionRef.current) {
            recoveryAdminSessionRef.current = false;
            clearRecoveryAdminSession();
        }
        try {
            sessionStorage.removeItem("admin:role");
        } catch { /* storage unavailable */ }
    }, []);

    useEffect(() => () => {
        if (recoveryAdminSessionRef.current) clearRecoveryAdminSession();
    }, []);

    const operatorSurface = operatorView === "login" ? (
        <Suspense fallback={<ScreenLoadingFallback screen="adminLogin" />}>
            <OperatorAdminLogin
                onLogin={(_account, password, role: AdminRole, token) => {
                    if (!setRecoveryAdminSession(token, password)) {
                        recoveryAdminSessionRef.current = false;
                        window.alert("Secure operator recovery storage is unavailable. No admin session was retained.");
                        return;
                    }
                    recoveryAdminSessionRef.current = true;
                    try { sessionStorage.setItem("admin:role", role); } catch { /* storage unavailable */ }
                    setAdminPassword(password);
                    setOperatorView("diagnostics");
                }}
                setScreen={() => closeOperatorRecovery()}
            />
        </Suspense>
    ) : operatorView === "diagnostics" ? (
        <Suspense fallback={<ScreenLoadingFallback screen="adminPanel" />}>
            <div className="card admin-panel global-menu-panel" data-operator-diagnostics>
                <h2>Operator recovery console</h2>
                <p className="hint">
                    This isolated console exposes authenticated diagnostics and bounded recovery actions
                    without touching the paused player save or mounting the broad content/player editor.
                </p>
                <OperatorDiagnostics adminPw={adminPassword} />
            </div>
        </Suspense>
    ) : null;

    return (
        <>
            <div inert={playerSurfaceBlocked} style={{ display: "contents" }}>
                <Activity name="player-surface" mode={playerSurfaceBlocked ? "hidden" : "visible"}>
                    {children}
                </Activity>
            </div>
            {playerSurfaceBlocked && (
                <PlayerSurfaceBlocker
                    onOperatorRecovery={() => setOperatorView("login")}
                    operatorSurface={operatorSurface}
                    onCloseOperatorRecovery={closeOperatorRecovery}
                />
            )}
        </>
    );
}
