import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.jsx'
import { bootstrapFont } from './fonts.js'
import { bootstrapMode } from './theme-mode.js'

// Apply the user's stored display font + color mode (if any) before
// React renders so there's no visible flash on first paint. Falls back
// to Bebas Neue + light mode via the CSS var defaults.
bootstrapFont();
bootstrapMode();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
