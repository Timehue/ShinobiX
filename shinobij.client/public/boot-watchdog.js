(function installBootWatchdog(window, document) {
    'use strict';

    var STARTUP_TIMEOUT_MS = 30000;
    var finished = false;
    var pendingReason = '';
    var reloadBound = false;
    var timerId;

    // ── Landing hero preload (see the note in index.html) ────────────────────
    // Mirrors PLAYER_ACCOUNTS_STORAGE in src/constants/game.ts. Duplicated as a
    // literal because this file is a pre-module classic script and cannot import
    // from the bundle; if that constant is ever renamed, rename it here too.
    var PLAYER_ACCOUNTS_STORAGE = 'ninjav-player-accounts-v1';
    var LANDING_HERO = '/landing-hero-village-v2.webp';

    /**
     * True only when this browser clearly holds a saved account, i.e. the player
     * will restore straight into the game and never paint the landing hero.
     *
     * Biased toward "false" on purpose. Guessing false costs what shipped before
     * this change (the preload fires for someone who may not need it); guessing
     * true costs a first-time visitor their LCP preload. So private mode, a parse
     * failure, and an empty store all fall through to preloading.
     */
    function hasSavedAccount() {
        try {
            var raw = window.localStorage.getItem(PLAYER_ACCOUNTS_STORAGE);
            if (!raw) return false;
            var accounts = JSON.parse(raw);
            if (!accounts || typeof accounts !== 'object') return false;
            return Object.keys(accounts).length > 0;
        } catch (_error) {
            return false;
        }
    }

    function preloadLandingHero() {
        if (hasSavedAccount()) return;
        try {
            var link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.type = 'image/webp';
            link.href = LANDING_HERO;
            link.setAttribute('fetchpriority', 'high');
            (document.head || document.documentElement).appendChild(link);
        } catch (_error) {
            // No preload is a slower first paint, never a broken one — the hero
            // still loads from landing-skin.css when that screen renders.
        }
    }

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

    preloadLandingHero();
    window.__shinobiBootReady = finishBoot;
    window.addEventListener('error', onResourceError, true);
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    document.addEventListener('DOMContentLoaded', bindMarkup);
    timerId = window.setTimeout(function onStartupTimeout() {
        showRecovery('timeout');
    }, STARTUP_TIMEOUT_MS);
})(window, document);
