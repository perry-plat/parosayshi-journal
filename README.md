# Field Notes

A standalone, local-first writing desk with physical paper, permanent highlighter ink, and PDF keepsakes.

## Run locally

```sh
npm install
npm run dev
```

Drafts stay in this browser's local storage. Highlight strokes stay in IndexedDB. The editor never sends journal content to a server.

## Analytics

Set `VITE_GA_MEASUREMENT_ID` to a GA4 web stream ID to enable production analytics. Local development does not load Google Analytics. Analytics records page views and a small set of content-free product actions; it never includes journal text or highlight data.
