import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

// Create root and render app
function detectRouterBasename(): string {
  if (typeof window !== "undefined") {
    const path = window.location.pathname || "";
    if (path === "/servetracker-staging" || path.startsWith("/servetracker-staging/")) {
      return "/servetracker-staging";
    }
    if (path === "/servetracker" || path.startsWith("/servetracker/")) {
      return "/servetracker";
    }
  }
  const fromVite = String(import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return fromVite || "/";
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={detectRouterBasename()}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
