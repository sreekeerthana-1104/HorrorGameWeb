// Resolves the laptop relay's HTTP base URL. A localhost/unset gateway only resolves on the
// laptop itself, so fall back to whatever host actually served this page -- lets the same code
// work whether the dashboard is opened on the laptop or from a phone/Quest browser.
export function getRelayHttpBase(): string {
  if (typeof window === "undefined") return "";
  const configured = process.env.NEXT_PUBLIC_REALTIME_GATEWAY_URL;
  const usableConfigured =
    configured && !/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(configured)
      ? configured.replace(/^ws/i, "http").replace(/\/$/, "")
      : "";
  return usableConfigured || `http://${window.location.hostname}:3001`;
}
