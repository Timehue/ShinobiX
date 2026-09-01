import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/late-normalize.css' // loaded last so cross-cutting chrome (close/back btns) wins the cascade
import './styles/veiled-steel.css' // final player-facing studio theme; intentionally wins legacy skin conflicts
import './styles/layout/adaptive-shell.css' // sole normal-page geometry and scrolling authority
import './styles/layout/adaptive-stages.css' // coordinate-preserving maps and specialized board stages
import './styles/layout/adaptive-tools.css' // responsive admin, creator, and authoring tools
import './styles/lite-fx-compositing.css' // LAST: html.lite-fx drops backdrop-filter on weak devices
import './lib/imageErrorGuard.ts' // install the global broken-image guard before first render
import './lib/perfTelemetry.ts' // register load/refresh perf observers before first paint
import { initSentry } from './lib/sentry.ts' // env-gated crash reporting (no-op without VITE_SENTRY_DSN)
import { applyLiteFxClass } from './lib/device-tier.ts' // tag <html class="lite-fx"> on weak mobiles to drop decorative motion
import { registerAssetServiceWorker } from './lib/register-sw.ts' // prod-only cache-first SW for hashed assets (never HTML/API)
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { LiveCapabilitiesProvider } from './components/LiveCapabilitiesProvider.tsx'
import { legalPageForPath } from './data/legal.ts'

// Keep the mobile-only product layer out of the desktop initial graph. Request
// it immediately on phones/tablets, and once on a later desktop-to-mobile
// resize; after loading, its own data-ui-mode gates still exclude combat.
const mobileProductViewport = window.matchMedia('(max-width: 979px)')
function ensureMobileProductLayer() {
    if (mobileProductViewport.matches) void import('./styles/mobile-noncombat-aaa.css')
}
ensureMobileProductLayer()
mobileProductViewport.addEventListener('change', ensureMobileProductLayer)

// LegalPage carries all the policy prose (every /terms, /privacy, … document),
// so it is lazy-loaded: keeping it off the entry chunk holds the entry-JS and
// initial-graph size budgets (a static import here regressed both). Only a
// visitor actually on a legal URL fetches it. legalPageForPath stays eager — it
// is a tiny slug lookup with no heavy dependencies.
// eslint-disable-next-line react-refresh/only-export-components -- entry module, not a fast-refresh boundary
const LegalPage = lazy(() => import('./screens/LegalPage.tsx').then((m) => ({ default: m.LegalPage })))
// This transparency notice is informational, not a consent or admission gate.
// Request it immediately with the player surface without putting its copy and
// inline presentation styles on the render-blocking module-preload graph.
// eslint-disable-next-line react-refresh/only-export-components -- entry module, not a fast-refresh boundary
const StorageNotice = lazy(() => import('./components/StorageNotice.tsx').then((m) => ({ default: m.StorageNotice })))
// Explicitly allow production-like QA bundles to retain the isolated preview
// routes without exposing them in ordinary production builds.
const qaPreviewsEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_QA_PREVIEWS === '1'
const IntroCinematicPreview = qaPreviewsEnabled
    ? lazy(() => import('./features/intro-cinematic/IntroCinematicPreview.tsx').then((m) => ({ default: m.IntroCinematicPreview })))
    : null
const CinematicVnPreview = qaPreviewsEnabled
    ? lazy(() => import('./features/cinematic-vn/CinematicVnPreview.tsx').then((m) => ({ default: m.CinematicVnPreview })))
    : null

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
const introPreview = qaPreviewsEnabled && new URLSearchParams(window.location.search).get('preview') === 'intro'
const cinematicVnPreview = qaPreviewsEnabled && new URLSearchParams(window.location.search).get('preview') === 'vn'

const root = createRoot(document.getElementById('root')!)
root.render(
    <StrictMode>
        {cinematicVnPreview && CinematicVnPreview ? (
            <Suspense fallback={null}>
                <CinematicVnPreview />
            </Suspense>
        ) : introPreview && IntroCinematicPreview ? (
            <Suspense fallback={null}>
                <IntroCinematicPreview />
            </Suspense>
        ) : legalSlug ? (
            <Suspense fallback={null}>
                <LegalPage slug={legalSlug} />
            </Suspense>
        ) : (
            <LiveCapabilitiesProvider>
                <ErrorBoundary>
                    <App />
                </ErrorBoundary>
                <Suspense fallback={null}>
                    <StorageNotice />
                </Suspense>
            </LiveCapabilitiesProvider>
        )}
    </StrictMode>,
)

// The CSP-safe pre-React watchdog is intentionally outside the app bundle so
// it can recover failed module/preload requests. Reaching this synchronous line
// proves the complete entry graph evaluated and React accepted its first render;
// cancel the bounded failure UI without waiting for App's data/network boot.
;(window as Window & { __shinobiBootReady?: () => void }).__shinobiBootReady?.()
