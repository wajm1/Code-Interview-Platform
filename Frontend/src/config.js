/**
 * Shared connection helpers for the Code Interview Platform.
 *
 * In local development the Vite app talks to Flask on :5050.
 * In production (Flask serving Frontend/dist, or GitHub Pages pointing
 * at a hosted backend) we use VITE_API_URL or the current origin.
 */

/** Base URL for HTTP + Socket.IO (no trailing slash). */
export function getApiBase() {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.trim().replace(/\/$/, "");
  }
  // Same-origin when the UI is served by Flask in production
  if (import.meta.env.PROD && typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:5050";
}
