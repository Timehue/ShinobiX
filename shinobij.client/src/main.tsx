import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/late-normalize.css' // loaded last so cross-cutting chrome (close/back btns) wins the cascade
import './lib/imageErrorGuard.ts' // install the global broken-image guard before first render
import './lib/perfTelemetry.ts' // register load/refresh perf observers before first paint
import { initSentry } from './lib/sentry.ts' // env-gated crash reporting (no-op without VITE_SENTRY_DSN)
import { applyLiteFxClass } from './lib/device-tier.ts' // tag <html class="lite-fx"> on weak mobiles to drop decorative motion
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

initSentry()
applyLiteFxClass()

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </StrictMode>,
)
