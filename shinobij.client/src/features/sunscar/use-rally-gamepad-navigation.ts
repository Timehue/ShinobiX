import { useEffect } from 'react';

/** Own controller navigation only while an immersive Rally session is open. */
export function useRallyGamepadNavigation() {
    useEffect(() => {
        let disposed = false, loading = false;
        let stop: (() => void) | undefined;
        const load = async () => {
            if (disposed || loading || stop) return;
            loading = true;
            try {
                const { installGamepadNavigation } = await import('../../lib/gamepad-navigation');
                if (!disposed) stop = installGamepadNavigation();
            } catch { /* Retry a temporary module failure on the next focus or connection. */ }
            finally { loading = false; }
        };
        void load();
        window.addEventListener('focus', load);
        window.addEventListener('gamepadconnected', load);
        document.addEventListener('visibilitychange', load);
        return () => {
            disposed = true;
            window.removeEventListener('focus', load);
            window.removeEventListener('gamepadconnected', load);
            document.removeEventListener('visibilitychange', load);
            stop?.();
        };
    }, []);
}
