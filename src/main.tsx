import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { initPushSubscriptionLifecycle, subscribeToPush } from './lib/push';

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

// Register service worker and auto-prompt for push notification permissions
if (typeof window !== "undefined") {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        console.log("ServeTracker ServiceWorker registered:", reg.scope);
      }).catch((err) => {
        console.warn("ServiceWorker registration failed:", err);
      });
    });
    // Re-subscribe when the browser rotates push keys (pushsubscriptionchange)
    initPushSubscriptionLifecycle();
  }

  // Auto-request notification permission on app launch
  if ("Notification" in window && Notification.permission === "default") {
    // Prompt permission automatically
    Notification.requestPermission().catch(() => {});
  }

  // Heal users who already granted permission before real push existed:
  // quietly create + register a subscription so background push starts working.
  if ("Notification" in window && Notification.permission === "granted") {
    window.addEventListener("load", () => {
      subscribeToPush().catch(() => {});
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={detectRouterBasename()}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
