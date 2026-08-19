type AnalyticsValue = string | number | boolean;
type AnalyticsParameters = Record<string, AnalyticsValue>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
const validMeasurementId = /^G-[A-Z0-9]+$/i.test(measurementId ?? "");

export function initializeAnalytics() {
  if (!import.meta.env.PROD || !validMeasurementId || !measurementId || window.gtag) return;

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args: unknown[]) => window.dataLayer?.push(args);
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: true });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
}

export function trackEvent(name: string, parameters?: AnalyticsParameters) {
  if (!window.gtag) return;
  window.gtag("event", name, parameters);
}

export function trackOncePerSession(name: string, parameters?: AnalyticsParameters) {
  const storageKey = `journal-desk:analytics:${name}`;
  try {
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, "true");
  } catch {
    // Analytics can still work when browser storage is unavailable.
  }
  trackEvent(name, parameters);
}
