import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.jsx'
import { bootstrapFont } from './fonts.js'
import { bootstrapMode } from './theme-mode.js'
import { registerLocalFonts } from './local-fonts.js'

// Apply the user's stored display font + color mode (if any) before
// React renders so there's no visible flash on first paint. Falls back
// to Bebas Neue + light mode via the CSS var defaults.
bootstrapFont();
bootstrapMode();
// Register the local /public/fonts/*.otf|ttf faces (Gotham, Press Gothic,
// United Sans) and kick off their preload. The Generate canvas awaits
// this via localFontsReady() before drawing so the first paint never
// falls back to Times.
registerLocalFonts();

// v5 (audit): top-level error boundary. Before this, any render throw
// unmounted the whole tree and left a white screen with no recovery. This
// catches it and offers a reload. Styling is self-contained (charcoal, no
// theme tokens) because the theme/app context may itself be the thing that
// crashed.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[blw] render error', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#16181d', color: '#e8eaed' }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 18, lineHeight: 1.5 }}>The page hit an unexpected error. Reloading usually fixes it — your saved work is local and safe.</div>
          <button onClick={() => window.location.reload()} style={{ background: '#C8302B', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Reload</button>
          <div style={{ marginTop: 14, fontSize: 12, opacity: 0.5, wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error).slice(0, 200)}</div>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
