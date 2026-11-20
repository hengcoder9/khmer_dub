import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './i18n'
import { App } from './app/App'

if (import.meta.env.DEV) {
  // handles for the dev-only UI smoke test (electron/main.ts runShots)
  Promise.all([import('./store/project'), import('./store/ui'), import('./lib/pipeline'), import('./store/settings')]).then(([project, ui, pipeline, settings]) => {
    ;(window as unknown as { __kd: unknown }).__kd = { project, ui, pipeline, settings }
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
