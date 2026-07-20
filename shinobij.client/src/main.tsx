import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/late-normalize.css' // loaded last so cross-cutting chrome (close/back btns) wins the cascade
import './styles/veiled-steel.css' // final player-facing studio theme; intentionally wins legacy skin conflicts
import './lib/imageErrorGuard.ts' // install the global broken-image guard before first render
import './lib/perfTelemetry.ts' // register load/refresh perf observers before first paint
import { initSentry } from './lib/sentry.ts' // env-gated crash reporting (no-op without VITE_SENTRY_DSN)
import { applyLiteFxClass } from './lib/device-tier.ts' // tag <html class="lite-fx"> on weak mobiles to drop decorative motion
import { registerAssetServiceWorker } from './lib/register-sw.ts' // prod-only cache-first SW for hashed assets (never HTML/API)
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { StorageNotice } from './components/StorageNotice.tsx'
import { legalPageForPath } from './data/legal.ts'
import { LegalPage } from './screens/LegalPage.tsx'

initSentry()
applyLiteFxClass()
registerAssetServiceWorker()

// Legal/policy URLs (/privacy, /terms, /cookies, …) render the policy directly,
// independent of login state. Without this they only rendered for logged-out
// visitors (via StartScreen), so a signed-in player, a shared deep link, or a
// crawler hitting /privacy got the game instead of the policy. The app itself is
// hash-routed, so these exact pathnames are never used for anything else.
const legalSlug = (() => {
    try { return legalPageForPath(window.location.pathname); } catch { return null; }
})()

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        {legalSlug ? (
            <LegalPage slug={legalSlug} />
        ) : (
            <>
                <ErrorBoundary>
                    <App />
                </ErrorBoundary>
                <StorageNotice />
            </>
        )}
    </StrictMode>,
)
