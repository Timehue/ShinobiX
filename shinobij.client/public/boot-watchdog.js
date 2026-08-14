/*
 * Pre-React boot recovery. This intentionally stays dependency-free and is
 * loaded as a same-origin classic script before Vite's module/preload graph.
 * Production CSP therefore needs no unsafe-inline exception, and a broken app
 * bundle can still leave the player with an explicit, keyboard-safe recovery.
 */
(function installBootWatchdog(window, document) {
    'use strict';

    var STARTUP_TIMEOUT_MS = 30000;
    var finished = false;
    var pendingReason = '';
    var reloadBound = false;
    var timerId;

    function byId(id) {
        return document.getElementById(id);
    }

    function sameOriginUrl(rawUrl) {
        if (!rawUrl) return null;
        try {
            var url = new URL(rawUrl, window.location.href);
            return url.origin === window.location.origin ? url : null;
        } catch (_error) {
            return null;
        }
    }

    function isCriticalAssetFailure(event) {
        var target = event && event.target;
        var tagName = target && String(target.tagName || '').toLowerCase();

        if (tagName === 'script') {
            return Boolean(sameOriginUrl(target.src)) && (
                String(target.type || '').toLowerCase() === 'module' ||
                /\/assets\/[^/?]+\.m?js(?:[?#]|$)/i.test(String(target.src || '')) ||
                /\/src\/main\.tsx(?:[?#]|$)/i.test(String(target.src || ''))
            );
        }

        if (tagName === 'link') {
            return String(target.rel || '').toLowerCase() === 'modulepreload' && Boolean(sameOriginUrl(target.href));
        }

        // A module graph can fail during evaluation after the script element's
        // resource event. While boot is still pending, a same-origin built-file
        // ErrorEvent is equally definitive; ordinary app errors arrive only
        // after __shinobiBootReady removes this listener.
        return Boolean(event && sameOriginUrl(event.filename)) &&
            /\/assets\/[^/?]+\.m?js(?:[?#]|$)/i.test(String(event.filename || ''));
    }

    function updateNetworkStatus() {
        var status = byId('boot-network-status');
        if (!status) return;
        status.textContent = window.navigator && window.navigator.onLine === false
            ? 'Your device appears offline. Reconnect, then reload.'
            : 'Check your connection, then try again.';
    }

    function bindReload(reload) {
        if (!reload || reloadBound) return;
        reload.addEventListener('click', reloadLatestGame, { once: true });
        reloadBound = true;
    }

    function showRecovery(reason) {
        if (finished) return;
        var splash = byId('boot-splash');
        var loading = byId('boot-loading-state');
        var recovery = byId('boot-recovery');
        var message = byId('boot-recovery-message');
        var reload = byId('boot-reload');
        if (!splash || !recovery || !reload) {
            pendingReason = reason;
            return;
        }

        pendingReason = '';
        bindReload(reload);
        window.clearTimeout(timerId);
        splash.setAttribute('role', 'alertdialog');
        splash.setAttribute('aria-busy', 'false');
        splash.setAttribute('aria-modal', 'true');
        splash.setAttribute('aria-labelledby', 'boot-recovery-title');
        splash.setAttribute('aria-describedby', 'boot-recovery-message boot-network-status');
        splash.removeAttribute('aria-label');
        splash.setAttribute('data-boot-failure', reason);
        if (loading) loading.hidden = true;
        if (message) {
            message.textContent = reason === 'timeout'
                ? 'The game is taking longer than expected to start. Any progress already saved is safe.'
                : 'A game file was interrupted. Any progress already saved is safe.';
        }
        recovery.hidden = false;
        updateNetworkStatus();
        try {
            reload.focus({ preventScroll: true });
        } catch (_error) {
            reload.focus();
        }
    }

    function onResourceError(event) {
        if (isCriticalAssetFailure(event)) showRecovery('asset');
    }

    function reloadLatestGame() {
        var reload = byId('boot-reload');
        var status = byId('boot-network-status');
        if (reload) reload.disabled = true;
        if (status) status.textContent = 'Reloading the latest game files...';
        // The server sends index.html with Cache-Control: no-cache, so this
        // explicit navigation revalidates the current chunk map. Never retry
        // automatically: a persistent outage must not strand players in a loop.
        window.location.reload();
    }

    function bindMarkup() {
        var reload = byId('boot-reload');
        bindReload(reload);
        if (pendingReason) showRecovery(pendingReason);
    }

    function finishBoot() {
        if (finished) return;
        finished = true;
        window.clearTimeout(timerId);
        window.removeEventListener('error', onResourceError, true);
        window.removeEventListener('online', updateNetworkStatus);
        window.removeEventListener('offline', updateNetworkStatus);
        document.removeEventListener('DOMContentLoaded', bindMarkup);
        try {
            delete window.__shinobiBootReady;
        } catch (_error) {
            window.__shinobiBootReady = undefined;
        }
    }

    window.__shinobiBootReady = finishBoot;
    window.addEventListener('error', onResourceError, true);
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    document.addEventListener('DOMContentLoaded', bindMarkup);
    timerId = window.setTimeout(function onStartupTimeout() {
        showRecovery('timeout');
    }, STARTUP_TIMEOUT_MS);
})(window, document);
