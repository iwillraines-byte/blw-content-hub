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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
