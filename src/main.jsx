import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.jsx'
import { bootstrapFont } from './fonts.js'

// Apply the user's stored display font (if any) before React renders so
// there's no visible swap on first paint. Falls back to Bebas Neue via
// the CSS var default.
bootstrapFont();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
