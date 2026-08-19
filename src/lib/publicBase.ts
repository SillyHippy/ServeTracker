export function detectPublicBase(): string {
  const explicit = import.meta.env.VITE_API_URL;
  if (explicit) return String(explicit).replace(/\/$/, "");

  if (typeof window !== "undefined") {
    const path = window.location.pathname || "";
    if (path === "/servetracker-staging" || path.startsWith("/servetracker-staging/")) {
      return "/servetracker-staging";
    }
    if (path === "/servetracker" || path.startsWith("/servetracker/")) {
      return "/servetracker";
    }
  }

  return String(import.meta.env.BASE_URL || "/").replace(/\/$/, "");
}

export const API_BASE = detectPublicBase();
