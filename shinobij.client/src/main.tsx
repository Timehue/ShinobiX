import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/imageErrorGuard.ts' // install the global broken-image guard before first render
import './lib/perfTelemetry.ts' // register load/refresh perf observers before first paint
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </StrictMode>,
)
