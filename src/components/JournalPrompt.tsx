import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArchiveIcon, ArrowCounterClockwiseIcon, ArrowUUpLeftIcon, CaretRightIcon, DownloadSimpleIcon, EraserIcon, HouseIcon, ListIcon, SquaresFourIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { Notebook01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { JournalDeskSurface } from "./JournalDeskSurfaceActive";
import { DeferredJournalDappledLight } from "./DeferredJournalDappledLight";
import { notebookPalette, type FolderMaterial, type JournalSnapshot } from "../lib/fieldNotesDb";
import { JournalInkLayer, type HighlighterMotion } from "./JournalInkLayer";
import {
  createJournalId,
  loadHighlightStrokes,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PDF_HEIGHT,
  PDF_WIDTH,
  persistHighlightStroke,
  removeHighlightStrokes,
  removePageHighlights,
  renderJournalPage,
  type HighlightStroke,
} from "./journalInk";
import "../styles/journal-prompt.css";

const prompts = [
  "What did you notice today that you would usually walk past?",
  "What are you making harder than it needs to be?",
  "Describe a small moment from this week that you want to keep.",
  "What are you quietly changing your mind about?",
  "Where did your attention feel most alive today?",
  "Write about something unfinished without trying to finish it.",
  "What would today look like if it were a page in a field notebook?",
  "Name a feeling you have been translating into work.",
  "What is one ordinary thing you want your future self to remember?",
  "What are you ready to make room for?",
] as const;

const storageKey = "field-notes:journal-drafts";
const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
const showPromptCard = false;
// The journal now has one authored desk rather than a surface gallery. The
// dormant explorations remain isolated in JournalDeskSurface for later study.
const deskSurface = "archive-signal" as const;

type ArchivedPage = {
  id: string;
  slot: number;
  text: string;
  deskX?: number;
  deskY?: number;
  deskOrder?: number;
};

type PageDrag = {
  element: HTMLButtonElement;
  id: string;
  lastAt: number;
  lastClientX: number;
  moved: boolean;
  originX: number;
  originY: number;
  pointerId: number;
  startRect: DOMRect;
  startX: number;
  startY: number;
  tilt: number;
};

type PaperPose = {
  centerX: number;
  centerY: number;
  rotation: number;
  visualHeight: number;
  visualWidth: number;
};

type JournalEntry = {
  current: string;
  currentId: string;
  pages: ArchivedPage[];
};

type DeletedPage = {
  index: number;
  page: ArchivedPage;
  strokes: HighlightStroke[];
};

type StoredJournalEntry = string | JournalEntry;
type JournalDrafts = Record<string, StoredJournalEntry>;

const pagePlacements = [
  { x: "-24vw", y: "-18vh", rotation: "-4.6deg", layer: 2 },
  { x: "23vw", y: "-14vh", rotation: "6.2deg", layer: 1 },
  { x: "-14vw", y: "9vh", rotation: "3.4deg", layer: 4 },
  { x: "19vw", y: "10vh", rotation: "-5.4deg", layer: 3 },
  { x: "1vw", y: "-24vh", rotation: "1.7deg", layer: 5 },
  { x: "-31vw", y: "4vh", rotation: "5.1deg", layer: 7 },
  { x: "31vw", y: "-2vh", rotation: "-3.2deg", layer: 6 },
  { x: "-8vw", y: "-7vh", rotation: "-6.4deg", layer: 9 },
  { x: "11vw", y: "-5vh", rotation: "4.2deg", layer: 8 },
  { x: "-26vw", y: "-28vh", rotation: "-2.3deg", layer: 10 },
  { x: "27vw", y: "-27vh", rotation: "3deg", layer: 11 },
  { x: "2vw", y: "12vh", rotation: "-1.8deg", layer: 12 },
] as const;

const restingPaperScale = 0.8;

function pageVisibleArea(rect: Pick<DOMRect, "height" | "width">) {
  const viewportMargin = 18;
  return {
    // A sheet may hang only one fifth beyond either side of the desk. On a
    // narrow screen, keep as much visible as the viewport can physically hold.
    horizontal: Math.min(
      rect.width * 0.8,
      Math.max(72, window.innerWidth - viewportMargin * 2),
    ),
    // The bottom is deliberately looser: roughly two thirds may leave while
    // the upper third remains available as a physical grab surface.
    topStrip: Math.min(
      rect.height * 0.34,
      Math.max(96, window.innerHeight - viewportMargin * 2),
    ),
  };
}

function clampedPageDelta(startRect: DOMRect, rawX: number, rawY: number) {
  const margin = 18;
  const visible = pageVisibleArea(startRect);
  const minimumX = visible.horizontal - startRect.right;
  const maximumX = window.innerWidth - visible.horizontal - startRect.left;
  const minimumY = margin - startRect.top;
  const maximumY = window.innerHeight - visible.topStrip - startRect.top;
  return {
    x: Math.min(maximumX, Math.max(minimumX, rawX)),
    y: Math.min(maximumY, Math.max(minimumY, rawY)),
  };
}

function pageViewportCorrection(rect: DOMRect) {
  const margin = 18;
  const visible = pageVisibleArea(rect);
  let x = 0;
  let y = 0;
  if (rect.right < visible.horizontal) x = visible.horizontal - rect.right;
  else if (rect.left > window.innerWidth - visible.horizontal) x = window.innerWidth - visible.horizontal - rect.left;
  if (rect.top < margin) y = margin - rect.top;
  else if (rect.top > window.innerHeight - visible.topStrip) y = window.innerHeight - visible.topStrip - rect.top;
  return { x, y };
}

function placeArchivedIndex(
  element: HTMLElement,
  rect: Pick<DOMRect, "left" | "right" | "width"> = element.getBoundingClientRect(),
  deltaX = 0,
) {
  const localWidth = element.offsetWidth;
  if (!localWidth || !rect.width) return;
  const left = rect.left + deltaX;
  const right = rect.right + deltaX;
  const visibleRight = Math.min(window.innerWidth - 16, right - 12);
  const localX = (visibleRight - left) / rect.width * localWidth;
  const clampedX = Math.min(localWidth - 12, Math.max(32, localX));
  element.style.setProperty("--page-index-x", `${clampedX.toFixed(2)}px`);
}

function paperPose(element: HTMLElement): PaperPose {
  const bounds = element.getBoundingClientRect();
  const computed = window.getComputedStyle(element);
  const matrix = new DOMMatrixReadOnly(computed.transform);
  const scale = Math.hypot(matrix.a, matrix.b) || 1;
  return {
    centerX: bounds.left + bounds.width / 2,
    centerY: bounds.top + bounds.height / 2,
    rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
    visualHeight: Number.parseFloat(computed.height) * scale,
    visualWidth: Number.parseFloat(computed.width) * scale,
  };
}

function pageImprintSeed(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pageScatter(id: string) {
  const seed = pageImprintSeed(id);
  return {
    rotation: (((seed >>> 16) & 255) / 255 - 0.5) * 4.4,
    x: ((seed & 255) / 255 - 0.5) * 10,
    y: (((seed >>> 8) & 255) / 255 - 0.5) * 9,
  };
}

function canvasTextLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const lines: string[] = [];
  text.split("\n").forEach((paragraph) => {
    if (!paragraph) {
      lines.push("");
      return;
    }
    let line = "";
    const words = paragraph.match(/\S+\s*/g) ?? [];
    words.forEach((word) => {
      const candidate = `${line}${word}`;
      if (!line || context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        return;
      }
      lines.push(line.trimEnd());
      line = word.trimStart();
      if (context.measureText(line).width <= maxWidth) return;
      let fragment = "";
      Array.from(line).forEach((character) => {
        const nextFragment = `${fragment}${character}`;
        if (fragment && context.measureText(nextFragment).width > maxWidth) {
          lines.push(fragment);
          fragment = character;
        } else fragment = nextFragment;
      });
      line = fragment;
    });
    lines.push(line.trimEnd());
  });
  return lines;
}

const ArchivedPagePreview = memo(function ArchivedPagePreview({ densityCap = 2, page, pageNumber, showIndex = true, tone = "archived" }: { densityCap?: number; page: ArchivedPage; pageNumber: number; showIndex?: boolean; tone?: "archived" | "fresh" }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let cancelled = false;
    let visible = true;

    const draw = () => {
      frame = 0;
      if (cancelled) return;
      const width = 480;
      const height = Math.round(width * 1.414);
      // The sheet is frequently scaled and rotated again inside the notebook
      // preview. Render at the requested density even when an embedded browser
      // reports a fractional/low devicePixelRatio, otherwise small mono type
      // is rasterized once at near-1x and looks soft after that second transform.
      const density = Math.max(1, densityCap);
      const pixelWidth = Math.round(width * density);
      const pixelHeight = Math.round(height * density);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      context.setTransform(density, 0, 0, density, 0, 0);

      const paper = context.createLinearGradient(0, 0, width, height);
      paper.addColorStop(0, tone === "fresh" ? "#fbfaf6" : "#f5f3ed");
      paper.addColorStop(0.62, tone === "fresh" ? "#f8f6f0" : "#efede7");
      paper.addColorStop(1, tone === "fresh" ? "#f0ede6" : "#e7e3db");
      context.fillStyle = paper;
      context.fillRect(0, 0, width, height);

      const seed = pageImprintSeed(page.id);
      const flecks = Math.round((width * height) / 560);
      for (let index = 0; index < flecks; index += 1) {
        const hash = Math.imul(seed ^ (index + 17), 2246822519) >>> 0;
        const x = (hash & 65535) / 65535 * width;
        const y = ((hash >>> 16) & 65535) / 65535 * height;
        const radius = 0.18 + ((hash >>> 6) & 31) / 31 * 0.42;
        const dark = (hash & 1) === 0;
        context.fillStyle = dark ? "rgb(72 67 60 / 0.04)" : "rgb(255 255 255 / 0.13)";
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }

      const fibres = Math.round(Math.max(28, width / 9));
      context.lineCap = "round";
      for (let index = 0; index < fibres; index += 1) {
        const hash = Math.imul(seed ^ (index + 701), 3266489917) >>> 0;
        const x = (hash & 65535) / 65535 * width;
        const y = ((hash >>> 16) & 65535) / 65535 * height;
        const length = 7 + ((hash >>> 7) & 63) / 63 * 26;
        const rise = (((hash >>> 13) & 31) / 31 - 0.5) * 2.2;
        context.strokeStyle = (hash & 1) === 0
          ? "rgb(70 63 55 / 0.035)"
          : "rgb(255 255 255 / 0.11)";
        context.lineWidth = 0.22 + ((hash >>> 20) & 15) / 15 * 0.25;
        context.beginPath();
        context.moveTo(x, y);
        context.quadraticCurveTo(x + length * 0.46, y + rise, x + length, y + rise * 0.35);
        context.stroke();
      }

      const handling = context.createRadialGradient(
        width * 0.72,
        height * 0.64,
        0,
        width * 0.72,
        height * 0.64,
        width * 0.68,
      );
      handling.addColorStop(0, "rgb(109 101 91 / 0.025)");
      handling.addColorStop(0.46, "rgb(255 255 255 / 0.018)");
      handling.addColorStop(1, "rgb(109 101 91 / 0)");
      context.fillStyle = handling;
      context.fillRect(0, 0, width, height);

      const referencePaper = document.querySelector<HTMLElement>(".journal-prompt__paper-stack--live .journal-prompt__paper");
      const referenceTextarea = referencePaper?.querySelector<HTMLTextAreaElement>("textarea");
      const referencePaperStyle = referencePaper ? window.getComputedStyle(referencePaper) : null;
      const referenceTextStyle = referenceTextarea ? window.getComputedStyle(referenceTextarea) : null;
      const referenceWidth = referencePaper?.getBoundingClientRect().width || 700;
      const previewScale = width / Math.max(1, referenceWidth);
      const insetX = (Number.parseFloat(referencePaperStyle?.paddingLeft || "52") || 52) * previewScale;
      const insetTop = (Number.parseFloat(referencePaperStyle?.paddingTop || "40") || 40) * previewScale;
      const insetBottom = (Number.parseFloat(referencePaperStyle?.paddingBottom || "64") || 64) * previewScale;
      const fontSize = (Number.parseFloat(referenceTextStyle?.fontSize || "17") || 17) * previewScale;
      const lineHeight = (Number.parseFloat(referenceTextStyle?.lineHeight || "33") || 33) * previewScale;
      const letterSpacing = (Number.parseFloat(referenceTextStyle?.letterSpacing || "-0.2") || -0.2) * previewScale;

      context.textBaseline = "alphabetic";
      if (showIndex) {
        context.textAlign = "right";
        const indexFontSize = 10 * previewScale;
        context.font = `400 ${indexFontSize}px "Geist Mono Variable", "Geist Mono", monospace`;
        context.fillStyle = "rgb(45 40 35 / 0.72)";
        const indexMetrics = context.measureText("00");
        const indexTop = 10 * previewScale;
        context.fillText(
          String(pageNumber).padStart(2, "0"),
          width - 10 * previewScale,
          indexTop + indexMetrics.actualBoundingBoxAscent,
        );
      }

      context.textAlign = "left";
      context.font = `300 ${fontSize}px "Geist Mono Variable", "Geist Mono", monospace`;
      if ("letterSpacing" in context) context.letterSpacing = `${letterSpacing}px`;
      const textMetrics = context.measureText("Mg");
      const baselineOffset = (lineHeight - fontSize) / 2 + textMetrics.actualBoundingBoxAscent;
      const lines = canvasTextLines(context, page.text, Math.max(1, width - insetX * 2));
      lines.forEach((line, lineIndex) => {
        const baseline = insetTop + baselineOffset + lineIndex * lineHeight;
        if (baseline > height - insetBottom) return;
        let x = insetX;
        Array.from(line).forEach((character, characterIndex) => {
          const characterWidth = context.measureText(character).width;
          if (character.trim()) {
            const imprintIndex = lineIndex * 127 + characterIndex;
            const hash = Math.imul(seed ^ (imprintIndex + 1), 2654435761) >>> 0;
            context.globalAlpha = tone === "fresh" ? 0.8 + ((hash >>> 16) & 255) / 255 * 0.08 : 0.7 + ((hash >>> 16) & 255) / 255 * 0.1;
            context.fillStyle = tone === "fresh" ? "#292622" : "#35312d";
            context.shadowColor = "transparent";
            context.shadowBlur = 0;
            // Keep every glyph locked to the canonical line and character
            // origin. Ink pressure still varies, but the archived sheet no
            // longer develops a visibly wandering baseline when scaled down.
            context.fillText(character, x, baseline);
          }
          x += characterWidth;
        });
      });
      context.globalAlpha = 1;
      context.shadowBlur = 0;
    };

    const scheduleDraw = () => {
      if (!visible) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(scheduleDraw);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) scheduleDraw();
      else window.cancelAnimationFrame(frame);
    }, { rootMargin: "160px" });
    observer.observe(canvas);
    visibilityObserver.observe(canvas);
    void document.fonts.ready.then(scheduleDraw);

    return () => {
      cancelled = true;
      observer.disconnect();
      visibilityObserver.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [densityCap, page.id, page.text, pageNumber, showIndex, tone]);

  return <canvas aria-hidden="true" className="journal-prompt__archived-preview" ref={canvasRef} />;
});

const InkedPagePreview = memo(function InkedPagePreview({
  densityCap = 2,
  page,
  pageNumber,
  showIndex = true,
  strokes,
  tone = "archived",
}: {
  densityCap?: number;
  page: ArchivedPage;
  pageNumber: number;
  showIndex?: boolean;
  strokes: HighlightStroke[];
  tone?: "archived" | "fresh";
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let cancelled = false;
    let visible = true;
    const draw = () => {
      frame = 0;
      if (cancelled) return;
      const density = Math.max(1, densityCap);
      canvas.width = Math.round(PAGE_WIDTH * density);
      canvas.height = Math.round(PAGE_HEIGHT * density);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      renderJournalPage(context, { page, pageNumber, showIndex, strokes, tone });
    };
    const scheduleDraw = () => {
      if (!visible) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(scheduleDraw);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) scheduleDraw();
      else window.cancelAnimationFrame(frame);
    }, { rootMargin: "160px" });
    observer.observe(canvas);
    visibilityObserver.observe(canvas);
    void document.fonts.ready.then(scheduleDraw);
    return () => {
      cancelled = true;
      observer.disconnect();
      visibilityObserver.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [densityCap, page, pageNumber, showIndex, strokes, tone]);

  return <canvas aria-hidden="true" className="journal-prompt__archived-preview" ref={canvasRef} />;
}, (previous, next) => (
  previous.densityCap === next.densityCap
  && previous.page === next.page
  && previous.pageNumber === next.pageNumber
  && previous.showIndex === next.showIndex
  && previous.tone === next.tone
  && previous.strokes.length === next.strokes.length
  && previous.strokes.every((stroke, index) => stroke === next.strokes[index])
));

function daySeed() {
  const now = new Date();
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
}

function loadDrafts(): JournalDrafts {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) as JournalDrafts : {};
  } catch {
    return {};
  }
}

function normalizeEntry(entry: StoredJournalEntry | undefined): JournalEntry {
  if (typeof entry === "string") return { current: entry, currentId: createJournalId(), pages: [] };
  return {
    current: typeof entry?.current === "string" ? entry.current : "",
    currentId: typeof entry?.currentId === "string" ? entry.currentId : createJournalId(),
    pages: Array.isArray(entry?.pages) ? entry.pages : [],
  };
}

function loadEntry(entryKey: string) {
  try {
    const scoped = window.localStorage.getItem(`${storageKey}:${entryKey}`);
    if (scoped) return normalizeEntry(JSON.parse(scoped) as StoredJournalEntry);
  } catch {
    // Fall through to the legacy notebook collection.
  }
  return normalizeEntry(loadDrafts()[entryKey]);
}

function nextDeskOrder(pages: ArchivedPage[]) {
  return pages.reduce((top, page, index) => Math.max(top, page.deskOrder ?? index + 1), 0) + 1;
}

function localDeskShadow(rotation: number, scale: number, x = -2, y = -3) {
  const radians = rotation * Math.PI / 180;
  const safeScale = Math.max(0.01, scale);
  return {
    x: (Math.cos(radians) * x + Math.sin(radians) * y) / safeScale,
    y: (-Math.sin(radians) * x + Math.cos(radians) * y) / safeScale,
  };
}

function pageTextLimit(textarea: HTMLTextAreaElement) {
  const paper = textarea.closest<HTMLElement>(".journal-prompt__paper");
  const paperStyle = paper ? window.getComputedStyle(paper) : null;
  const textStyle = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(textStyle.lineHeight) || 31;
  const paperHeight = paper?.clientHeight || lineHeight * 23;
  const paddingTop = Number.parseFloat(paperStyle?.paddingTop || "0") || 0;
  const paddingBottom = Number.parseFloat(paperStyle?.paddingBottom || "0") || 0;
  const usableHeight = Math.max(lineHeight, paperHeight - paddingTop - paddingBottom);

  return Math.max(lineHeight, Math.floor(usableHeight / lineHeight) * lineHeight);
}

function splitPageText(value: string, textarea: HTMLTextAreaElement, limit: number) {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed",
    top: "0",
    left: "-10000px",
    width: `${textarea.clientWidth}px`,
    margin: "0",
    padding: "0",
    border: "0",
    font: style.font,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    overflowWrap: "break-word",
    whiteSpace: "pre-wrap",
    visibility: "hidden",
  });
  document.body.appendChild(mirror);

  const fits = (end: number) => {
    mirror.textContent = value.slice(0, end) || " ";
    return mirror.scrollHeight <= limit;
  };
  if (fits(value.length)) {
    mirror.remove();
    return { completed: value.trimEnd(), carry: "" };
  }
  let low = 1;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  mirror.remove();

  const whitespace = Math.max(value.lastIndexOf(" ", low), value.lastIndexOf("\n", low));
  const breakAt = whitespace > low * 0.72 ? whitespace + 1 : Math.max(1, low);
  return {
    completed: value.slice(0, breakAt).trimEnd(),
    carry: value.slice(breakAt).trimStart(),
  };
}

function paginatePageText(value: string, textarea: HTMLTextAreaElement, limit: number) {
  if (!value) return [""];
  const chunks: string[] = [];
  let remaining = value;
  for (let index = 0; index < 100 && remaining; index += 1) {
    const { completed, carry } = splitPageText(remaining, textarea, limit);
    if (!completed || carry === remaining) {
      chunks.push(remaining.trimEnd());
      break;
    }
    chunks.push(completed);
    remaining = carry;
  }
  return chunks.length ? chunks : [value];
}

function createDeskSound() {
  type SoundName = "backspace" | "highlighter-close" | "highlighter-draw" | "highlighter-open" | "key-1" | "key-2" | "key-3" | "key-4" | "return" | "space";

  type SoundShape = {
    gain: number;
    rate: number;
  };

  const files: Record<SoundName, string> = {
    "key-1": assetPath("assets/sounds/journal/key-1.wav?v=mechanical-2"),
    "key-2": assetPath("assets/sounds/journal/key-2.wav?v=mechanical-2"),
    "key-3": assetPath("assets/sounds/journal/key-3.wav?v=mechanical-2"),
    "key-4": assetPath("assets/sounds/journal/key-4.wav?v=mechanical-2"),
    space: assetPath("assets/sounds/journal/space.wav?v=mechanical-2"),
    backspace: assetPath("assets/sounds/journal/backspace.wav?v=mechanical-2"),
    "highlighter-close": assetPath("assets/sounds/journal/highlighter-close.wav?v=physical-1"),
    "highlighter-draw": assetPath("assets/sounds/journal/highlighter-draw-loop.wav?v=continuous-1"),
    "highlighter-open": assetPath("assets/sounds/journal/highlighter-open.wav?v=physical-1"),
    return: assetPath("assets/sounds/journal/return.wav?v=mechanical-2"),
  };
  const regularKeys: SoundName[] = ["key-1", "key-2", "key-3", "key-4"];
  const outputGain = 0.3;
  let context: AudioContext | null = null;
  let lastStrikeAt = 0;
  let smoothedInterval = 0;
  let dynamics: SoundShape = { gain: 1, rate: 1 };
  const samples = new Map<string, AudioBuffer>();
  const pendingSamples = new Map<SoundName, Promise<void>>();
  const heldKeys = new Map<string, number>();
  let markerMotionFadeTimer = 0;
  let markerContactRequested = false;
  let markerContactVoice: { filter: BiquadFilterNode; gain: GainNode; source: AudioBufferSourceNode } | null = null;

  const ensureContext = () => {
    context ||= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  };

  const loadSample = (name: SoundName) => {
    const existing = pendingSamples.get(name);
    if (existing) return existing;
    const audio = ensureContext();
    const path = files[name];
    const pending = (async () => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Unable to load journal sound: ${path}`);
      samples.set(path, await audio.decodeAudioData(await response.arrayBuffer()));
    })().catch(() => {
      pendingSamples.delete(name);
    });
    pendingSamples.set(name, pending);
    return pending;
  };

  const stopMarkerContact = (release = 0.13) => {
    window.clearTimeout(markerMotionFadeTimer);
    markerMotionFadeTimer = 0;
    markerContactRequested = false;
    const voice = markerContactVoice;
    markerContactVoice = null;
    if (!voice || !context) return;
    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
    voice.gain.gain.linearRampToValueAtTime(0.0001, now + release);
    try {
      voice.source.stop(now + release + 0.025);
    } catch {
      // The voice may already have been stopped during teardown.
    }
  };

  const startMarkerContact = () => {
    markerContactRequested = true;
    const startNow = () => {
      if (!markerContactRequested || markerContactVoice) return;
      const audio = ensureContext();
      const recorded = samples.get(files["highlighter-draw"]);
      if (!recorded) return;
      const source = audio.createBufferSource();
      const filter = audio.createBiquadFilter();
      const gain = audio.createGain();
      const now = audio.currentTime;
      source.buffer = recorded;
      source.loop = true;
      source.playbackRate.value = 0.9;
      filter.type = "lowpass";
      filter.frequency.value = 1350;
      filter.Q.value = 0.65;
      gain.gain.setValueAtTime(0.0001, now);
      source.connect(filter).connect(gain).connect(audio.destination);
      markerContactVoice = { filter, gain, source };
      source.onended = () => {
        if (markerContactVoice?.source === source) markerContactVoice = null;
      };
      const safeOffset = 0.06 + Math.random() * Math.max(0, recorded.duration - 0.12);
      source.start(now, safeOffset);
    };

    if (samples.has(files["highlighter-draw"])) startNow();
    else void loadSample("highlighter-draw").then(startNow);
  };

  const shapeMarkerMotion = (motion: HighlighterMotion) => {
    if (!markerContactRequested || !context || !markerContactVoice) return;
    const now = context.currentTime;
    const unit = (value: number, fallback = 0) => Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : fallback;
    const speed = unit(motion.speed);
    const pressure = unit(motion.pressure, 0.5);
    const turn = unit(motion.turn);
    const acceleration = unit(motion.acceleration);
    const voice = markerContactVoice;
    const targetGain = 0.04 + pressure * 0.065 + speed * 0.035 + turn * 0.018 + acceleration * 0.008;
    const targetRate = 0.86 + speed * 0.22 + turn * 0.025;
    const targetFrequency = 1050 + speed * 2650 + pressure * 420 + turn * 950;
    voice.gain.gain.cancelScheduledValues(now);
    voice.source.playbackRate.cancelScheduledValues(now);
    voice.filter.frequency.cancelScheduledValues(now);
    voice.filter.Q.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(targetGain, now, 0.032);
    voice.source.playbackRate.setTargetAtTime(targetRate, now, 0.045);
    voice.filter.frequency.setTargetAtTime(targetFrequency, now, 0.038);
    voice.filter.Q.setTargetAtTime(0.55 + turn * 1.35, now, 0.04);
    window.clearTimeout(markerMotionFadeTimer);
    markerMotionFadeTimer = window.setTimeout(() => {
      if (!context || !markerContactVoice) return;
      markerContactVoice.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.045);
    }, 115);
  };

  const play = (name: SoundName, gainOverride?: number, rateOverride?: number, delay = 0) => {
    const playNow = () => {
      const audio = ensureContext();
      const path = files[name];
      const recorded = samples.get(path);
      if (recorded) {
        const source = audio.createBufferSource();
        const gain = audio.createGain();
        source.buffer = recorded;
        const baseRate = name.startsWith("key-") ? 0.985 + Math.random() * 0.03 : 1;
        const baseGain = name === "return" ? 0.62 : name === "space" ? 0.58 : 0.52 + Math.random() * 0.05;
        source.playbackRate.value = (rateOverride ?? baseRate) * dynamics.rate;
        gain.gain.value = Math.min(1, (gainOverride ?? baseGain) * dynamics.gain) * outputGain;
        source.connect(gain).connect(audio.destination);
        source.start();
        return;
      }

      void loadSample(name).then(() => {
        if (samples.has(path)) playNow();
      });
    };

    if (delay) window.setTimeout(playNow, delay);
    else playNow();
  };

  const shapeFromCadence = (now: number) => {
    const interval = lastStrikeAt ? now - lastStrikeAt : Number.POSITIVE_INFINITY;
    lastStrikeAt = now;
    if (interval > 1.2) {
      smoothedInterval = 0;
      dynamics = { gain: 1.06, rate: 0.985 };
      return true;
    }

    smoothedInterval = smoothedInterval
      ? smoothedInterval * 0.72 + interval * 0.28
      : interval;
    if (smoothedInterval < 0.085) dynamics = { gain: 0.84, rate: 1.025 };
    else if (smoothedInterval < 0.14) dynamics = { gain: 0.91, rate: 1.012 };
    else if (smoothedInterval > 0.45) dynamics = { gain: 1.06, rate: 0.988 };
    else if (smoothedInterval > 0.28) dynamics = { gain: 1.03, rate: 0.995 };
    else dynamics = { gain: 1, rate: 1 };
    return false;
  };

  const playPair = (
    first: [SoundName, number, number],
    second: [SoundName, number, number],
    delay: number,
  ) => {
    play(...first);
    play(...second, delay);
  };

  return {
    dispose() {
      markerContactRequested = false;
      try {
        markerContactVoice?.source.stop();
      } catch {
        // The contact voice may already have ended.
      }
      markerContactVoice = null;
      void context?.close();
      context = null;
    },
    markerClose() {
      stopMarkerContact();
      play("highlighter-close", 0.82, 0.98 + Math.random() * 0.025);
    },
    markerStrokeEnd() {
      stopMarkerContact();
    },
    markerStrokeMotion(motion: HighlighterMotion) {
      shapeMarkerMotion(motion);
    },
    markerStrokeStart() {
      startMarkerContact();
    },
    markerOpen() {
      play("highlighter-open", 0.9, 0.985 + Math.random() * 0.025);
    },
    press(event: KeyboardEvent) {
      if (event.repeat) return;
      const isAudibleKey = event.key.length === 1
        || ["Backspace", "Delete", "Enter", "Escape", "Tab", "CapsLock"].includes(event.key);
      if (!isAudibleKey) return;

      const now = performance.now() / 1000;
      heldKeys.set(event.code, now);
      if (shapeFromCadence(now)) play("space", 0.1, 0.72);

      if (event.metaKey && !event.altKey && !event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === "c" && !event.shiftKey) return playPair(["key-2", 0.42, 1.1], ["key-4", 0.32, 1.22], 32);
        if (key === "x" && !event.shiftKey) return playPair(["key-3", 0.44, 1.18], ["backspace", 0.38, 1.05], 26);
        if (key === "v") return playPair(["space", 0.44, 0.92], ["return", 0.32, 0.96], 42);
        if (key === "z" && event.shiftKey) return playPair(["key-1", 0.3, 0.82], ["return", 0.33, 1.05], 38);
        if (key === "z") return playPair(["backspace", 0.35, 0.88], ["key-1", 0.28, 0.78], 40);
        if (key === "s" && !event.shiftKey) return playPair(["return", 0.38, 0.92], ["key-4", 0.24, 1.18], 50);
      }

      if (event.key === "Escape") return playPair(["backspace", 0.34, 0.82], ["key-1", 0.18, 0.72], 25);
      if (event.key === "Tab") return playPair(["key-1", 0.3, 1], ["key-2", 0.22, 1.08], 25);
      if (event.key === "CapsLock" && event.getModifierState("CapsLock")) return playPair(["key-3", 0.3, 1], ["key-4", 0.26, 1.15], 34);
      if (event.key === "CapsLock") return playPair(["key-4", 0.28, 1.08], ["key-3", 0.24, 0.92], 34);
      if (event.key === "Enter") play("return");
      else if (event.key === "Backspace" || event.key === "Delete") play("backspace");
      else if (event.key === " ") play("space");
      else if (event.key.length === 1 && !event.altKey && !event.ctrlKey) {
        play(regularKeys[Math.floor(Math.random() * regularKeys.length)]);
      }
    },
    release(event: KeyboardEvent) {
      const startedAt = heldKeys.get(event.code);
      heldKeys.delete(event.code);
      if (startedAt === undefined || performance.now() / 1000 - startedAt < 0.42) return;
      dynamics = { gain: 1, rate: 1 };
      play("key-1", 0.14, 0.72);
    },
  };
}

type JournalPromptProps = {
  folderTitle?: string;
  journalKey?: string;
  notebookMaterial?: FolderMaterial;
  onArchiveNotebook?: () => void | Promise<void>;
  onHome?: () => void;
  onJournalChange?: (snapshot: JournalSnapshot) => void;
  promptText?: string;
};

export function NotebookCoverArtwork({ children, inside = false, material, title }: { children?: ReactNode; inside?: boolean; material: FolderMaterial; title?: string }) {
  const palette = notebookPalette[material];
  return (
    <div
      className="journal-prompt__notebook-cover-art"
      data-inside={inside}
      data-material={material}
      style={{ "--notebook-cover-color": palette.color, "--notebook-cover-edge": palette.edge, "--notebook-cover-ink": palette.ink } as React.CSSProperties}
    >
      <strong>{children ?? title}</strong>
    </div>
  );
}

type PhysicalHighlighterProps = {
  active: boolean;
  className?: string;
  initialEntry?: boolean;
  onToggle: () => void;
  visible?: boolean;
};

export function PhysicalHighlighter({ active, className = "", initialEntry = false, onToggle, visible = true }: PhysicalHighlighterProps) {
  return (
    <div
      aria-hidden={!visible}
      className={`journal-prompt__marker-station ${className}`.trim()}
      data-active={active}
      data-initial-entry={initialEntry}
      data-visible={visible}
    >
      <button
        aria-label="Highlighter"
        aria-pressed={active}
        className="journal-prompt__marker"
        onClick={onToggle}
        tabIndex={visible ? 0 : -1}
        type="button"
      >
        <span aria-hidden="true" className="journal-prompt__marker-figure">
          <i className="journal-prompt__marker-contact-shadow" />
          <img alt="" className="journal-prompt__marker-capped" draggable="false" src={assetPath("assets/tools/journal-mini-highlighter-capped-v1.png")} />
          <img alt="" className="journal-prompt__marker-body" draggable="false" src={assetPath("assets/tools/journal-mini-highlighter-body-v1.png")} />
          <img alt="" className="journal-prompt__marker-cap" draggable="false" src={assetPath("assets/tools/journal-mini-highlighter-cap-v1.png")} />
        </span>
      </button>
    </div>
  );
}

function PhysicalEraser({ onPutDown }: { onPutDown: () => void }) {
  return (
    <div className="journal-prompt__eraser-station">
      <button
        aria-label="Put eraser down"
        className="journal-prompt__physical-eraser"
        onClick={(event) => {
          event.stopPropagation();
          onPutDown();
        }}
        type="button"
      >
        <img
          alt=""
          draggable="false"
          src={assetPath("assets/tools/journal-chisel-eraser-v1.png")}
        />
      </button>
    </div>
  );
}

async function downloadNotebookPdf({
  folderTitle,
  pages,
  strokes,
}: {
  folderTitle: string;
  pages: ArchivedPage[];
  strokes: HighlightStroke[];
}) {
  if (!pages.length) return false;
  await document.fonts.ready;
  const { PDFDocument } = await import("pdf-lib");
  const documentCopy = await PDFDocument.create();
  const canvas = document.createElement("canvas");
  canvas.width = PDF_WIDTH;
  canvas.height = PDF_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return false;
  for (const [index, page] of pages.entries()) {
    renderJournalPage(context, {
      page,
      pageNumber: index + 1,
      strokes,
      tone: "fresh",
    });
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Unable to render this journal page.")), "image/png");
    });
    const bytes = new Uint8Array(await png.arrayBuffer());
    const image = await documentCopy.embedPng(bytes);
    const pdfPage = documentCopy.addPage([595.28, 841.89]);
    pdfPage.drawImage(image, { height: pdfPage.getHeight(), width: pdfPage.getWidth(), x: 0, y: 0 });
  }
  const safeTitle = folderTitle
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 80) || "Field notes";
  const pdfBytes = await documentCopy.save();
  const pdfBuffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
  const fileUrl = URL.createObjectURL(new Blob([pdfBuffer], { type: "application/pdf" }));
  const download = document.createElement("a");
  download.href = fileUrl;
  download.download = `${safeTitle}.pdf`;
  download.hidden = true;
  document.body.appendChild(download);
  download.click();
  window.setTimeout(() => {
    download.remove();
    URL.revokeObjectURL(fileUrl);
  }, 120_000);
  return true;
}

export async function downloadJournalSnapshot({
  folderTitle,
  snapshot,
}: {
  folderTitle: string;
  snapshot: JournalSnapshot;
}) {
  const allStrokes = await loadHighlightStrokes().catch(() => [] as HighlightStroke[]);
  const pageIds = new Set([...snapshot.pages.map((page) => page.id), snapshot.currentId]);
  const strokes = allStrokes.filter((stroke) => pageIds.has(stroke.pageId));
  const pages = [
    ...snapshot.pages.filter((page) => page.text.trim() || strokes.some((stroke) => stroke.pageId === page.id)),
    ...(snapshot.current.trim() || strokes.some((stroke) => stroke.pageId === snapshot.currentId)
      ? [{ id: snapshot.currentId, slot: snapshot.pages.length % pagePlacements.length, text: snapshot.current.trimEnd() }]
      : []),
  ];
  return downloadNotebookPdf({ folderTitle, pages, strokes });
}

export async function countMeaningfulJournalPages(snapshot: JournalSnapshot) {
  const allStrokes = await loadHighlightStrokes().catch(() => [] as HighlightStroke[]);
  const pageIds = new Set([...snapshot.pages.map((page) => page.id), snapshot.currentId]);
  const strokes = allStrokes.filter((stroke) => pageIds.has(stroke.pageId));
  return snapshot.pages.filter((page) => page.text.trim() || strokes.some((stroke) => stroke.pageId === page.id)).length
    + Number(Boolean(snapshot.current.trim() || strokes.some((stroke) => stroke.pageId === snapshot.currentId)));
}

export function JournalPrompt({ folderTitle, journalKey, notebookMaterial = "kraft", onArchiveNotebook, onHome, onJournalChange, promptText }: JournalPromptProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const pickedUpPaperRef = useRef<HTMLDivElement | null>(null);
  const releaseSheetRef = useRef<HTMLDivElement | null>(null);
  const releaseSourceRef = useRef<PaperPose | null>(null);
  const pickupOriginRef = useRef<PaperPose | null>(null);
  const pageFieldRef = useRef<HTMLDivElement | null>(null);
  const pageDragRef = useRef<PageDrag | null>(null);
  const editedPageRef = useRef<string | null>(null);
  const paperSwitchRef = useRef(0);
  const deskArrangeTimerRef = useRef<number | null>(null);
  const markerVisibilityTimerRef = useRef<number | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const soundRef = useRef<ReturnType<typeof createDeskSound> | null>(null);
  const reducedMotion = useReducedMotion();
  const [promptIndex] = useState(() => daySeed() % prompts.length);
  const prompt = promptText ?? prompts[promptIndex];
  const entryKey = journalKey ?? prompt;
  const notebookPaletteEntry = notebookPalette[notebookMaterial];
  const [initialEntry] = useState(() => loadEntry(entryKey));
  const [answer, setAnswer] = useState(initialEntry.current);
  const [livePageId, setLivePageId] = useState(initialEntry.currentId);
  const [pages, setPages] = useState(initialEntry.pages);
  const [highlightStrokes, setHighlightStrokes] = useState<HighlightStroke[]>([]);
  const highlightStrokesByPage = useMemo(() => {
    const grouped = new Map<string, HighlightStroke[]>();
    highlightStrokes.forEach((stroke) => {
      const pageStrokes = grouped.get(stroke.pageId);
      if (pageStrokes) pageStrokes.push(stroke);
      else grouped.set(stroke.pageId, [stroke]);
    });
    return grouped;
  }, [highlightStrokes]);
  const [highlighterActive, setHighlighterActive] = useState(false);
  const [eraserActive, setEraserActive] = useState(false);
  const [highlighterVisible, setHighlighterVisible] = useState(() => {
    try {
      return window.localStorage.getItem(`${storageKey}:highlighter-visible`) !== "false";
    } catch {
      return true;
    }
  });
  const [highlighterRendered, setHighlighterRendered] = useState(highlighterVisible);
  const [activeArchivedId, setActiveArchivedId] = useState<string | null>(null);
  const [returningPaperId, setReturningPaperId] = useState<string | null>(null);
  const [exportPageIndex, setExportPageIndex] = useState(0);
  const [exportTurningIndex, setExportTurningIndex] = useState<number | null>(null);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [deletedPage, setDeletedPage] = useState<DeletedPage | null>(null);
  const [pageCycle, setPageCycle] = useState(0);
  const [initialDeskEntry, setInitialDeskEntry] = useState(true);
  const [releasingPageId, setReleasingPageId] = useState<string | null>(null);
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [deskTidy, setDeskTidy] = useState(() => {
    try {
      return window.localStorage.getItem(`${storageKey}:desk-tidy:${entryKey}`) === "true";
    } catch {
      return false;
    }
  });
  const [deskArranging, setDeskArranging] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const activeArchivedPage = activeArchivedId
    ? pages.find((page) => page.id === activeArchivedId) ?? null
    : null;
  const editorValue = activeArchivedPage?.text ?? answer;

  useEffect(() => {
    const timer = window.setTimeout(() => setInitialDeskEntry(false), 2400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const closeToolMenu = (event: PointerEvent) => {
      if (!toolMenuRef.current?.contains(event.target as Node)) setToolMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeToolMenu);
    return () => window.removeEventListener("pointerdown", closeToolMenu);
  }, [toolMenuOpen]);

  useEffect(() => {
    if (exportPreviewOpen) void import("pdf-lib");
  }, [exportPreviewOpen]);

  useEffect(() => () => {
    if (markerVisibilityTimerRef.current !== null) {
      window.clearTimeout(markerVisibilityTimerRef.current);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadHighlightStrokes()
      .then((strokes) => {
        if (!cancelled) setHighlightStrokes(strokes);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const deactivate = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!highlighterActive && !eraserActive)) return;
      event.preventDefault();
      event.stopPropagation();
      if (highlighterActive) soundRef.current?.markerClose();
      setHighlighterActive(false);
      setEraserActive(false);
      window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("keydown", deactivate, true);
    return () => window.removeEventListener("keydown", deactivate, true);
  }, [eraserActive, highlighterActive]);

  const commitHighlight = useCallback((stroke: HighlightStroke) => {
    setHighlightStrokes((current) => [...current, stroke]);
    const save = (attempt: number) => {
      void persistHighlightStroke(stroke)
        .catch(() => {
          if (attempt < 5) window.setTimeout(() => save(attempt + 1), Math.min(8000, 500 * 2 ** attempt));
        });
    };
    save(0);
  }, []);

  const eraseHighlights = useCallback((strokeIds: string[]) => {
    if (!strokeIds.length) return;
    const erasedIds = new Set(strokeIds);
    const pageId = activeArchivedId ?? livePageId;
    const hasRemainingInk = highlightStrokes.some((stroke) =>
      stroke.pageId === pageId && !erasedIds.has(stroke.id),
    );
    setHighlightStrokes((current) => current.filter((stroke) => !erasedIds.has(stroke.id)));
    const remove = (attempt: number) => {
      void removeHighlightStrokes(strokeIds).catch(() => {
        if (attempt < 5) window.setTimeout(() => remove(attempt + 1), Math.min(8000, 500 * 2 ** attempt));
      });
    };
    remove(0);
    if (!hasRemainingInk) {
      setEraserActive(false);
      window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    }
  }, [activeArchivedId, highlightStrokes, livePageId]);

  const soundHighlightWetChange = useCallback((wet: boolean) => {
    if (wet) soundRef.current?.markerStrokeStart();
    else soundRef.current?.markerStrokeEnd();
  }, []);

  const soundHighlightMotion = useCallback((motion: HighlighterMotion) => {
    soundRef.current?.markerStrokeMotion(motion);
  }, []);

  const toggleHighlighterVisibility = () => {
    const nextVisible = !highlighterVisible;
    if (markerVisibilityTimerRef.current !== null) {
      window.clearTimeout(markerVisibilityTimerRef.current);
      markerVisibilityTimerRef.current = null;
    }
    if (!nextVisible) {
      if (highlighterActive) soundRef.current?.markerClose();
      setHighlighterActive(false);
      window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
      markerVisibilityTimerRef.current = window.setTimeout(() => {
        setHighlighterRendered(false);
        markerVisibilityTimerRef.current = null;
      }, 480);
    } else {
      setHighlighterRendered(true);
    }
    setHighlighterVisible(nextVisible);
    try {
      window.localStorage.setItem(`${storageKey}:highlighter-visible`, String(nextVisible));
    } catch {
      // The visibility preference can remain session-local when storage is unavailable.
    }
  };

  useLayoutEffect(() => {
    let frame = 0;
    const reflowOversizedSheets = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const limit = pageTextLimit(textarea);
        setPages((current) => {
          let changed = false;
          let nextOrder = nextDeskOrder(current);
          const next: ArchivedPage[] = [];
          current.forEach((page) => {
            const chunks = paginatePageText(page.text, textarea, limit);
            if (chunks.length === 1) {
              next.push(page);
              return;
            }
            changed = true;
            next.push({ ...page, text: chunks[0] });
            chunks.slice(1).forEach((text, chunkIndex) => {
              next.push({
                deskOrder: nextOrder,
                id: `${page.id}-continuation-${Date.now()}-${chunkIndex}`,
                slot: next.length % pagePlacements.length,
                text,
              });
              nextOrder += 1;
            });
          });
          return changed ? next : current;
        });
      });
    };

    reflowOversizedSheets();
    window.addEventListener("resize", reflowOversizedSheets);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", reflowOversizedSheets);
    };
  }, [activeArchivedId]);

  useLayoutEffect(() => {
    if (!activeArchivedPage || reducedMotion) return;
    const paper = pickedUpPaperRef.current;
    const origin = pickupOriginRef.current;
    if (!paper || !origin) return;
    const destination = paper.getBoundingClientRect();
    const x = origin.centerX - (destination.left + destination.width / 2);
    const y = origin.centerY - (destination.top + destination.height / 2);
    const scale = Math.min(
      origin.visualWidth / Math.max(1, destination.width),
      origin.visualHeight / Math.max(1, destination.height),
    );
    const settledShadow = localDeskShadow(origin.rotation, scale);
    const animation = paper.animate(
      [
        { transform: `translate(${x}px, ${y}px) rotate(${origin.rotation}deg) scale(${scale})`, transformOrigin: "50% 50%" },
        { transform: "translate(0, 0) rotate(0deg) scale(1)", transformOrigin: "50% 50%" },
      ],
      { duration: 410, easing: "cubic-bezier(0.2, 0.82, 0.24, 1)" },
    );
    animation.id = "journal-paper-pickup";

    const liftedShadow = paper.querySelector<HTMLElement>(".journal-prompt__paper-shadow--picked");
    const liftedShadowAnimation = liftedShadow?.animate(
      [
        { filter: "blur(3.2px)", opacity: 0 },
        { filter: "blur(2.45px)", opacity: 0.58, offset: 0.5 },
        { filter: "blur(2.1px)", opacity: 0.9 },
      ],
      { duration: 410, easing: "cubic-bezier(0.2, 0.82, 0.24, 1)", fill: "forwards" },
    );
    if (liftedShadowAnimation) liftedShadowAnimation.id = "journal-paper-pickup-lifted-shadow";

    const contactShadow = paper.querySelector<HTMLElement>(".journal-prompt__return-contact-shadow");
    const contactShadowAnimation = contactShadow?.animate(
      [
        {
          filter: "blur(2.7px)",
          opacity: 0.52,
          transform: `translate(${settledShadow.x}px, ${settledShadow.y}px) scale(1)`,
        },
        {
          filter: "blur(4.2px)",
          opacity: 0.12,
          offset: 0.48,
          transform: `translate(${settledShadow.x * 1.7}px, ${settledShadow.y * 1.7}px) scale(0.995)`,
        },
        {
          filter: "blur(5.4px)",
          opacity: 0,
          transform: `translate(${settledShadow.x * 2.4}px, ${settledShadow.y * 2.4}px) scale(0.99)`,
        },
      ],
      { duration: 410, easing: "cubic-bezier(0.2, 0.82, 0.24, 1)", fill: "forwards" },
    );
    if (contactShadowAnimation) contactShadowAnimation.id = "journal-paper-pickup-contact-shadow";

    return () => {
      animation.cancel();
      liftedShadowAnimation?.cancel();
      contactShadowAnimation?.cancel();
    };
  }, [activeArchivedPage?.id, reducedMotion]);

  useLayoutEffect(() => {
    if (!returningPaperId) return;
    const paper = pickedUpPaperRef.current;
    const origin = pickupOriginRef.current;
    let settled = false;
    let cancelled = false;
    let settleTimer = 0;
    let paperAnimation: Animation | null = null;
    let liftedShadowAnimation: Animation | null = null;
    let contactShadowAnimation: Animation | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      discardArchivedPageIfBlank(returningPaperId);
      setActiveArchivedId(null);
      setDeletedPage(null);
      setReturningPaperId(null);
      pickupOriginRef.current = null;
    };
    if (reducedMotion || !paper || !origin) {
      finish();
      return;
    }

    const current = paper.getBoundingClientRect();
    const x = origin.centerX - (current.left + current.width / 2);
    const y = origin.centerY - (current.top + current.height / 2);
    const scale = Math.min(
      origin.visualWidth / Math.max(1, current.width),
      origin.visualHeight / Math.max(1, current.height),
    );
    const settledShadow = localDeskShadow(origin.rotation, scale);
    paperAnimation = paper.animate(
      [
        { transform: "translate(0, 0) rotate(0deg) scale(1)", transformOrigin: "50% 50%" },
        { transform: `translate(${x}px, ${y}px) rotate(${origin.rotation}deg) scale(${scale})`, transformOrigin: "50% 50%" },
      ],
      { duration: 300, easing: "cubic-bezier(0.2, 0.86, 0.22, 1)", fill: "forwards" },
    );
    paperAnimation.id = "journal-paper-return";

    const liftedShadow = paper.querySelector<HTMLElement>(".journal-prompt__paper-shadow--picked");
    if (liftedShadow) {
      liftedShadowAnimation = liftedShadow.animate(
        [
          { filter: "blur(2.1px)", opacity: 0.9 },
          { filter: "blur(2.45px)", opacity: 0.7, offset: 0.5 },
          { filter: "blur(2.85px)", opacity: 0.24, offset: 0.84 },
          { filter: "blur(3.1px)", opacity: 0 },
        ],
        { duration: 300, easing: "cubic-bezier(0.2, 0.86, 0.22, 1)", fill: "forwards" },
      );
      liftedShadowAnimation.id = "journal-paper-return-lifted-shadow";
    }

    const contactShadow = paper.querySelector<HTMLElement>(".journal-prompt__return-contact-shadow");
    if (contactShadow) {
      contactShadowAnimation = contactShadow.animate(
        [
          {
            filter: "blur(5.4px)",
            opacity: 0,
            transform: `translate(${settledShadow.x * 2.4}px, ${settledShadow.y * 2.4}px) scale(0.99)`,
          },
          {
            filter: "blur(4.1px)",
            opacity: 0.1,
            offset: 0.54,
            transform: `translate(${settledShadow.x * 1.75}px, ${settledShadow.y * 1.75}px) scale(0.994)`,
          },
          {
            filter: "blur(3.15px)",
            opacity: 0.34,
            offset: 0.84,
            transform: `translate(${settledShadow.x * 1.18}px, ${settledShadow.y * 1.18}px) scale(0.998)`,
          },
          {
            filter: "blur(2.7px)",
            opacity: 0.52,
            transform: `translate(${settledShadow.x}px, ${settledShadow.y}px) scale(1)`,
          },
        ],
        { duration: 300, easing: "cubic-bezier(0.2, 0.86, 0.22, 1)", fill: "forwards" },
      );
      contactShadowAnimation.id = "journal-paper-return-contact-shadow";
    }

    void paperAnimation.finished.then(() => {
      if (cancelled) return;
      // Let the contact frame paint before swapping the moving sheet for its
      // desk representation. Without this hold React can commit the handoff
      // in the same frame as the final shadow keyframe.
      settleTimer = window.setTimeout(finish, 12);
    }).catch(() => {
      if (!cancelled) finish();
    });
    return () => {
      cancelled = true;
      window.clearTimeout(settleTimer);
      paperAnimation?.cancel();
      liftedShadowAnimation?.cancel();
      contactShadowAnimation?.cancel();
    };
  }, [reducedMotion, returningPaperId]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const minimumTextHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 31;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(minimumTextHeight, textarea.scrollHeight)}px`;
    const stack = textarea.closest<HTMLElement>(".journal-prompt__paper-stack");
    if (stack) {
      const paper = textarea.closest<HTMLElement>(".journal-prompt__paper");
      const paperStyle = paper ? window.getComputedStyle(paper) : null;
      const paddingTop = Number.parseFloat(paperStyle?.paddingTop || "40") || 40;
      const paddingBottom = Number.parseFloat(paperStyle?.paddingBottom || "64") || 64;
      const feed = Math.min(
        paper?.clientHeight || window.innerHeight * 0.88,
        paddingTop + Math.max(minimumTextHeight, textarea.scrollHeight) + paddingBottom,
      );
      stack.style.setProperty("--paper-feed", `${feed}px`);
    }

    const editorId = activeArchivedPage?.id ?? livePageId;
    if (editedPageRef.current !== editorId) return;
    const limit = pageTextLimit(textarea);
    if (activeArchivedPage) {
      if (textarea.scrollHeight <= limit || !editorValue.trim()) return;
      const { completed, carry } = splitPageText(editorValue, textarea, limit);
      if (!completed) return;
      const continuationId = createJournalId();
      releaseSourceRef.current = pickedUpPaperRef.current ? paperPose(pickedUpPaperRef.current) : null;
      setPages((current) => {
        const activeIndex = current.findIndex((page) => page.id === activeArchivedPage.id);
        if (activeIndex < 0) return current;
        const continuation: ArchivedPage = {
          deskOrder: nextDeskOrder(current),
          id: continuationId,
          slot: current.length % pagePlacements.length,
          text: carry,
        };
        const next = current.map((page) => (
          page.id === activeArchivedPage.id ? { ...page, text: completed } : page
        ));
        next.splice(activeIndex + 1, 0, continuation);
        return next;
      });
      editedPageRef.current = continuationId;
      setActiveArchivedId(continuationId);
      setReleasingPageId(activeArchivedPage.id);
      setDeletedPage(null);
      setPageCycle((current) => current + 1);
      return;
    }
    if (textarea.scrollHeight <= limit || !editorValue.trim()) return;
    const { completed, carry } = splitPageText(editorValue, textarea, limit);
    if (!completed) return;
    const pageId = livePageId;
    releaseSourceRef.current = paperRef.current ? paperPose(paperRef.current) : null;
    setPages((current) => [...current, {
      deskOrder: nextDeskOrder(current),
      id: pageId,
      slot: current.length % pagePlacements.length,
      text: completed,
    }]);
    const nextLivePageId = createJournalId();
    editedPageRef.current = nextLivePageId;
    setReleasingPageId(pageId);
    setAnswer(carry);
    setLivePageId(nextLivePageId);
    setDeletedPage(null);
    setPageCycle((current) => current + 1);
  }, [editorValue, livePageId]);

  useLayoutEffect(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(".journal-prompt__paper-stack--live textarea");
    const stack = textarea?.closest<HTMLElement>(".journal-prompt__paper-stack");
    if (!textarea || !stack) return;
    const minimumTextHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 31;
    const paper = textarea.closest<HTMLElement>(".journal-prompt__paper");
    const paperStyle = paper ? window.getComputedStyle(paper) : null;
    const paddingTop = Number.parseFloat(paperStyle?.paddingTop || "40") || 40;
    const paddingBottom = Number.parseFloat(paperStyle?.paddingBottom || "64") || 64;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(minimumTextHeight, textarea.scrollHeight)}px`;
    const feed = Math.min(
      paper?.clientHeight || window.innerHeight * 0.88,
      paddingTop + Math.max(minimumTextHeight, textarea.scrollHeight) + paddingBottom,
    );
    stack.style.setProperty("--paper-feed", `${feed}px`);
  }, [answer, activeArchivedId]);

  useLayoutEffect(() => {
    if (!pageCycle) return;
    const frame = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pageCycle, reducedMotion]);

  useLayoutEffect(() => {
    if (!releasingPageId) return;
    const source = releaseSourceRef.current;
    const movingSheet = releaseSheetRef.current;
    const target = pageFieldRef.current?.querySelector<HTMLElement>(
      `[data-page-id="${CSS.escape(releasingPageId)}"]`,
    );
    const releasingPage = pages.find((page) => page.id === releasingPageId);
    let firstFrame = 0;
    let secondFrame = 0;
    let fallback = 0;
    let movement: Animation | null = null;
    let shadowMovement: Animation | null = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      releaseSourceRef.current = null;
      setReleasingPageId((current) => current === releasingPageId ? null : current);
    };

    if (!source || !movingSheet || !target || !releasingPage) {
      firstFrame = window.requestAnimationFrame(finish);
      return () => window.cancelAnimationFrame(firstFrame);
    }

    firstFrame = window.requestAnimationFrame(() => {
      const targetRect = target.getBoundingClientRect();
      const correction = pageViewportCorrection(targetRect);
      placeArchivedIndex(target, targetRect, correction.x);
      if (Math.abs(correction.x) > 0.5 || Math.abs(correction.y) > 0.5) {
        const nextX = (releasingPage.deskX ?? 0) + correction.x;
        const nextY = (releasingPage.deskY ?? 0) + correction.y;
        target.style.setProperty("--page-drag-x", `${nextX}px`);
        target.style.setProperty("--page-drag-y", `${nextY}px`);
        setPages((current) => current.map((page) => (
          page.id === releasingPageId ? { ...page, deskX: nextX, deskY: nextY } : page
        )));
      }

      secondFrame = window.requestAnimationFrame(() => {
        const targetPose = paperPose(target);
        const x = targetPose.centerX - source.centerX;
        const y = targetPose.centerY - source.centerY;
        const scale = Math.min(
          targetPose.visualWidth / Math.max(1, source.visualWidth),
          targetPose.visualHeight / Math.max(1, source.visualHeight),
        );
        if (reducedMotion) {
          finish();
          return;
        }

        movement = movingSheet.animate(
          [
            {
              filter: "brightness(1.035) saturate(1.015)",
              transform: `translate(0, 0) rotate(${source.rotation}deg) scale(1)`,
            },
            {
              filter: "brightness(1.025) saturate(1.01)",
              offset: 0.14,
              transform: `translate(0, -7px) rotate(${source.rotation - 0.06}deg) scale(1.002)`,
            },
            {
              filter: "brightness(1.003) saturate(1)",
              offset: 0.82,
              transform: `translate(${x}px, ${y - 2.5}px) rotate(${targetPose.rotation - 0.1}deg) scale(${scale * 1.004})`,
            },
            {
              filter: "brightness(1) saturate(1)",
              transform: `translate(${x}px, ${y}px) rotate(${targetPose.rotation}deg) scale(${scale})`,
            },
          ],
          { duration: 390, easing: "cubic-bezier(0.2, 0.84, 0.22, 1)", fill: "forwards" },
        );
        movement.id = "journal-page-lift-and-place";

        const shadow = movingSheet.querySelector<HTMLElement>(".journal-prompt__release-shadow");
        if (shadow) {
          shadowMovement = shadow.animate(
            [
              { filter: "blur(2px)", opacity: 0.2, transform: "translate(1px, 2px) scale(0.998)" },
              { filter: "blur(5px)", opacity: 0.36, offset: 0.16, transform: "translate(5px, 9px) scale(0.985)" },
              { filter: "blur(2.8px)", opacity: 0.25, transform: "translate(2px, 4px) scale(0.995)" },
            ],
            { duration: 390, easing: "cubic-bezier(0.2, 0.84, 0.22, 1)", fill: "forwards" },
          );
        }

        fallback = window.setTimeout(finish, 500);
        void movement.finished.then(finish).catch(finish);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(fallback);
      movement?.cancel();
      shadowMovement?.cancel();
    };
  }, [reducedMotion, releasingPageId]);

  useEffect(() => {
    const sound = createDeskSound();
    soundRef.current = sound;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".journal-prompt__export-viewer")) {
        setExportPreviewOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      sound.dispose();
      if (soundRef.current === sound) soundRef.current = null;
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => () => {
    if (deskArrangeTimerRef.current !== null) window.clearTimeout(deskArrangeTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    // Visibility is a desk invariant, including tidy mode. Older saved desk
    // positions may predate the current limits, so recover those sheets as
    // soon as the journal opens instead of letting them remain off-canvas.
    if (deskArranging || releasingPageId) return;
    let frame = 0;
    const keepPagesInView = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const field = pageFieldRef.current;
        if (!field) return;
        const corrections = new Map<string, { x: number; y: number }>();
        field.querySelectorAll<HTMLElement>(".journal-prompt__archived-page").forEach((element) => {
          const id = element.dataset.pageId;
          if (!id) return;
          const rect = element.getBoundingClientRect();
          const { x, y } = pageViewportCorrection(rect);
          placeArchivedIndex(element, rect, x);
          if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) corrections.set(id, { x, y });
        });
        if (!corrections.size) return;
        setPages((current) => current.map((page) => {
          const correction = corrections.get(page.id);
          return correction
            ? { ...page, deskX: (page.deskX ?? 0) + correction.x, deskY: (page.deskY ?? 0) + correction.y }
            : page;
        }));
      });
    };
    keepPagesInView();
    window.addEventListener("resize", keepPagesInView);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", keepPagesInView);
    };
  }, [activeArchivedId, deskArranging, deskTidy, pages.length]);

  useEffect(() => {
    const snapshot = { current: answer, currentId: livePageId, pages };
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(`${storageKey}:${entryKey}`, JSON.stringify(snapshot));
      } catch {
        // The writing experience remains usable when browser storage is unavailable.
      }
      onJournalChange?.(snapshot);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [answer, entryKey, livePageId, onJournalChange, pages]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`${storageKey}:desk-tidy:${entryKey}`, String(deskTidy));
    } catch {
      // Desk arrangement can remain session-local when browser storage is unavailable.
    }
  }, [deskTidy, entryKey]);

  const meaningfulPages = pages.filter((page) => page.text.trim() || Boolean(highlightStrokesByPage.get(page.id)?.length));
  const livePageHasInk = Boolean(highlightStrokesByPage.get(livePageId)?.length);
  const exportSheets: ArchivedPage[] = [
    ...meaningfulPages,
    ...(answer.trim() || livePageHasInk ? [{ id: livePageId, slot: meaningfulPages.length % pagePlacements.length, text: answer.trimEnd() }] : []),
  ];
  const exportLeaves = Array.from(
    { length: Math.ceil(exportSheets.length / 2) },
    (_, index) => ({
      back: exportSheets[index * 2 + 1] ?? null,
      front: exportSheets[index * 2] ?? null,
    }),
  );
  const exportBookSheets = [
    { back: null, front: null, key: "notebook-cover", kind: "cover" as const },
    ...exportLeaves.map((leaf, index) => ({
      ...leaf,
      key: `${leaf.front?.id ?? "blank"}-${leaf.back?.id ?? "blank"}-${index}`,
      kind: "paper" as const,
    })),
  ];
  const exportBookOpen = exportPageIndex > 0;
  const turnExportBook = (nextLeaf: number, sheetIndex: number) => {
    // The final written page can live on the back of the last paper sheet.
    // Allow one terminal turn so that side is readable against the endpaper.
    if (exportTurningIndex !== null || nextLeaf < 0 || nextLeaf > exportBookSheets.length) return;
    setExportPageIndex(nextLeaf);
    if (!reducedMotion) setExportTurningIndex(sheetIndex);
  };
  const updateEditorValue = (value: string) => {
    editedPageRef.current = activeArchivedId ?? livePageId;
    if (!activeArchivedId) {
      setAnswer(value);
      return;
    }
    setPages((current) => current.map((page) => (
      page.id === activeArchivedId ? { ...page, text: value } : page
    )));
  };

  const discardArchivedPageIfBlank = (id: string | null) => {
    if (!id) return;
    const hasInk = Boolean(highlightStrokesByPage.get(id)?.length);
    setPages((current) => current.filter((page) => page.id !== id || page.text.trim() || hasInk));
  };

  const switchToPage = (id: string | null) => {
    if (id === activeArchivedId) return;
    const switchId = paperSwitchRef.current + 1;
    paperSwitchRef.current = switchId;

    const commitSwitch = () => {
      if (paperSwitchRef.current !== switchId) return;
      editedPageRef.current = null;
      discardArchivedPageIfBlank(activeArchivedId);
      setActiveArchivedId(id);
      setDeletedPage(null);
      setPageCycle((current) => current + 1);
    };

    const paper = paperRef.current;
    if (reducedMotion || !paper) {
      commitSwitch();
      return;
    }

    paper.getAnimations().forEach((animation) => animation.cancel());
    const animation = paper.animate(
      [
        { filter: "brightness(1)", opacity: 1, transform: "translateY(0) rotate(0deg)" },
        { filter: "brightness(1.008)", opacity: 1, transform: "translateY(-1.5px) rotate(-0.025deg)", offset: 0.32 },
        { filter: "brightness(0.985)", opacity: 0.88, transform: "translateY(30px) rotate(0.08deg)" },
      ],
      { duration: 170, easing: "cubic-bezier(0.32, 0.02, 0.5, 1)", fill: "forwards" },
    );
    animation.id = "journal-paper-switch-out";
    let committed = false;
    const finishSwitch = () => {
      if (committed) return;
      committed = true;
      window.clearTimeout(fallback);
      commitSwitch();
    };
    const fallback = window.setTimeout(finishSwitch, 230);
    void animation.finished.then(finishSwitch).catch(finishSwitch);
  };

  const openArchivedPage = (id: string, source?: HTMLElement | null) => {
    if (returningPaperId) return;
    editedPageRef.current = null;
    discardArchivedPageIfBlank(activeArchivedId);
    const sourcePage = source ?? pageFieldRef.current?.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(id)}"]`);
    pickupOriginRef.current = sourcePage ? paperPose(sourcePage) : null;
    setActiveArchivedId(id);
    setDeletedPage(null);
  };

  const continueOnNewPage = () => {
    if (!answer.trim() && !livePageHasInk) return;
    const pageId = livePageId;
    editedPageRef.current = null;
    releaseSourceRef.current = paperRef.current ? paperPose(paperRef.current) : null;
    setPages((current) => [...current, {
      deskOrder: nextDeskOrder(current),
      id: pageId,
      slot: current.length % pagePlacements.length,
      text: answer.trimEnd(),
    }]);
    setReleasingPageId(pageId);
    setAnswer("");
    setLivePageId(createJournalId());
    setDeletedPage(null);
    setPageCycle((current) => current + 1);
  };

  const returnToLivePage = () => {
    if (!activeArchivedId || returningPaperId) return;
    editedPageRef.current = null;
    // Render the archived face before motion starts, then let the return effect
    // move that single composited sheet while the live sheet comes back in the
    // same beat. This prevents editable text from reflowing while scaled.
    setReturningPaperId(activeArchivedId);
  };

  const openPreviousPage = (textarea: HTMLTextAreaElement) => {
    if (textarea.value.length || textarea.selectionStart !== 0 || textarea.selectionEnd !== 0) return false;
    if (!activeArchivedId) {
      const previous = pages.at(-1);
      if (!previous) return false;
      openArchivedPage(previous.id);
      return true;
    }
    const activeIndex = pages.findIndex((page) => page.id === activeArchivedId);
    if (activeIndex <= 0) return false;
    openArchivedPage(pages[activeIndex - 1].id);
    return true;
  };

  const deleteActivePage = () => {
    if (!activeArchivedId) return;
    const index = pages.findIndex((page) => page.id === activeArchivedId);
    if (index < 0) return;
    editedPageRef.current = null;
    const pageStrokes = highlightStrokesByPage.get(activeArchivedId) ?? [];
    setDeletedPage({ index, page: pages[index], strokes: pageStrokes });
    setHighlightStrokes((current) => current.filter((stroke) => stroke.pageId !== activeArchivedId));
    void removePageHighlights(activeArchivedId);
    setPages((current) => current.filter((page) => page.id !== activeArchivedId));
    setActiveArchivedId(null);
    setPageCycle((current) => current + 1);
  };

  const undoDelete = () => {
    if (!deletedPage) return;
    editedPageRef.current = null;
    setPages((current) => {
      const next = [...current];
      next.splice(Math.min(deletedPage.index, next.length), 0, deletedPage.page);
      return next;
    });
    setActiveArchivedId(deletedPage.page.id);
    setHighlightStrokes((current) => [...current, ...deletedPage.strokes]);
    deletedPage.strokes.forEach((stroke) => void persistHighlightStroke(stroke));
    setDeletedPage(null);
    setPageCycle((current) => current + 1);
  };

  const downloadEntry = useCallback(async () => {
    await downloadNotebookPdf({
      folderTitle: folderTitle ?? prompt,
      pages: exportSheets,
      strokes: highlightStrokes,
    });
  }, [exportSheets, folderTitle, highlightStrokes, prompt]);

  const bumpPaper = () => {
    if (reducedMotion) return;
    const paper = pickedUpPaperRef.current ?? paperRef.current;
    if (!paper) return;
    paper.getAnimations?.().forEach((animation) => {
      if (animation.id === "journal-enter-bump") animation.cancel();
    });
    const animation = paper.animate(
      [
        { transform: "translateY(0)" },
        { transform: "translateY(2.5px)" },
        { transform: "translateY(-0.7px)" },
        { transform: "translateY(0)" },
      ],
      { duration: 170, easing: "cubic-bezier(0.2, 0.72, 0.28, 1)" },
    );
    animation.id = "journal-enter-bump";
  };

  const toggleDeskOrder = () => {
    if (deskArrangeTimerRef.current !== null) window.clearTimeout(deskArrangeTimerRef.current);
    pageDragRef.current = null;
    setDraggingPageId(null);
    setDeskArranging(true);
    setPages((current) => current.map((page, index) => ({
      ...page,
      deskOrder: index + 1,
      deskX: 0,
      deskY: 0,
    })));
    setDeskTidy(true);
    deskArrangeTimerRef.current = window.setTimeout(() => {
      setDeskArranging(false);
      deskArrangeTimerRef.current = null;
    }, 620);
  };

  // The desk is a collection of physical sheets, so editing a sheet must not
  // remove it from layout just because its text is temporarily blank. Empty
  // sheets are still excluded from export and are discarded only on exit.
  const visiblePages = pages;
  const tidyIntervals = Math.max(1, visiblePages.length - 1);
  const tidyStepX = Math.min(76, 520 / tidyIntervals);
  const tidyMobileStepX = Math.min(34, 120 / tidyIntervals);
  const activePageIndex = activeArchivedPage
    ? pages.findIndex((page) => page.id === activeArchivedPage.id)
    : pages.length;
  const activePageNumber = activeArchivedPage ? activePageIndex + 1 : pages.length + 1;
  const releasingPageIndex = releasingPageId
    ? pages.findIndex((page) => page.id === releasingPageId)
    : -1;
  const releasingPage = releasingPageIndex >= 0 ? pages[releasingPageIndex] : null;
  const releaseSource = releaseSourceRef.current;

  return (
    <div
      className="journal-prompt"
      data-desk-arranging={deskArranging}
      data-page-releasing={Boolean(releasingPageId)}
      data-desk-surface={deskSurface}
      data-desk-tidy={deskTidy}
      data-highlighter-active={highlighterActive}
      onClick={(event) => {
        if (!activeArchivedPage || !(event.target instanceof Element)) return;
        if (event.target.closest(".journal-prompt__paper, .journal-prompt__tools, .journal-prompt__archived-page, .journal-prompt__marker-station, .journal-prompt__eraser-station")) return;
        returnToLivePage();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${folderTitle ?? "Journal"} writing desk`}
    >
      <JournalDeskSurface
        archivedCount={pages.length}
        interactionActive={Boolean(draggingPageId)}
        reducedMotion={reducedMotion}
        surface={deskSurface}
      />
      <DeferredJournalDappledLight reducedMotion={reducedMotion} />

      {exportPreviewOpen && exportSheets.length ? (
        <section className="journal-prompt__export-viewer" aria-label="Field notes preview" role="dialog" aria-modal="true">
          <div className="journal-prompt__export-print" aria-hidden="true">
            <article className="journal-prompt__export-paper journal-prompt__export-paper--cover">
              <NotebookCoverArtwork material={notebookMaterial} title={folderTitle ?? "Field notes"} />
            </article>
            {exportSheets.map((page, index) => (
              <article className="journal-prompt__export-paper" key={page.id}>
                <InkedPagePreview densityCap={2} page={page} pageNumber={index + 2} strokes={highlightStrokesByPage.get(page.id) ?? []} tone="fresh" />
              </article>
            ))}
          </div>
          <div className="journal-prompt__export-book">
            <div
              className="journal-prompt__keepsake"
              data-at-end={exportPageIndex === exportBookSheets.length}
              data-cover-turning={exportTurningIndex === 0}
              data-open={exportBookOpen}
              data-turning={exportTurningIndex !== null}
              aria-label={exportBookOpen ? `${folderTitle ?? "Field notes"} notebook, spread ${exportPageIndex} of ${exportLeaves.length}` : `Closed ${folderTitle ?? "Field notes"} notebook. Click to open.`}
              onClick={(event) => {
                if (!exportBookOpen) {
                  turnExportBook(1, 0);
                  return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                if (event.clientX < bounds.left + bounds.width / 2) {
                  turnExportBook(exportPageIndex - 1, exportPageIndex - 1);
                } else turnExportBook(exportPageIndex + 1, exportPageIndex);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !exportBookOpen) turnExportBook(1, 0);
                if (event.key === "ArrowLeft") turnExportBook(exportPageIndex - 1, exportPageIndex - 1);
                if (event.key === "ArrowRight") turnExportBook(exportPageIndex + 1, exportPageIndex);
              }}
              role="group"
              style={{ "--cover-color": notebookPaletteEntry.color, "--cover-edge": notebookPaletteEntry.edge, "--cover-ink": notebookPaletteEntry.ink } as React.CSSProperties}
              tabIndex={0}
            >
              <div className="journal-prompt__keepsake-cover" aria-hidden="true" />
              <div className="journal-prompt__keepsake-paper-block" aria-hidden="true" />
              {exportBookSheets.map((leaf, index) => {
                const isFlipped = index < exportPageIndex;
                const isTurning = index === exportTurningIndex;
                const depth = (isFlipped ? index + 1 : exportBookSheets.length - index) * 0.35;
                return (
                <div
                  className="journal-prompt__keepsake-sheet"
                  data-flipped={isFlipped}
                  data-kind={leaf.kind}
                  data-turning={isTurning}
                  key={leaf.key}
                  onTransitionEnd={(event) => {
                    if (isTurning && event.currentTarget === event.target && event.propertyName === "transform") setExportTurningIndex(null);
                  }}
                  style={{
                    "--keepsake-depth": `${depth}px`,
                    zIndex: isTurning ? exportBookSheets.length + 12 : isFlipped ? index + 2 : exportBookSheets.length - index + 2,
                  } as React.CSSProperties}
                >
                  <div className="journal-prompt__keepsake-face journal-prompt__keepsake-face--front">
                    {leaf.kind === "cover" ? (
                      <div className="journal-prompt__keepsake-cover-face journal-prompt__keepsake-cover-face--outside"><NotebookCoverArtwork material={notebookMaterial} title={folderTitle ?? "Field notes"} /></div>
                    ) : leaf.front ? <InkedPagePreview densityCap={2} page={leaf.front} pageNumber={(index - 1) * 2 + 1} strokes={highlightStrokesByPage.get(leaf.front.id) ?? []} tone="fresh" /> : null}
                  </div>
                  <div className="journal-prompt__keepsake-face journal-prompt__keepsake-face--back">
                    {leaf.kind === "cover" ? (
                      <div className="journal-prompt__keepsake-cover-face journal-prompt__keepsake-cover-face--inside">
                        <NotebookCoverArtwork inside material={notebookMaterial} title={folderTitle ?? "Field notes"} />
                        <i className="journal-prompt__keepsake-endpaper" aria-hidden="true" />
                      </div>
                    ) : leaf.back ? <InkedPagePreview densityCap={2} page={leaf.back} pageNumber={(index - 1) * 2 + 2} strokes={highlightStrokesByPage.get(leaf.back.id) ?? []} tone="fresh" /> : null}
                  </div>
                </div>
              )})}
              <i className="journal-prompt__keepsake-spine" aria-hidden="true" />
            </div>
            <div className="journal-prompt__export-actions">
              <button aria-label="Download as PDF" onClick={downloadEntry} title="Download as PDF" type="button"><DownloadSimpleIcon aria-hidden="true" size={20} /></button>
              <button aria-label="Close preview" onClick={() => setExportPreviewOpen(false)} title="Close preview" type="button"><XIcon aria-hidden="true" size={20} /></button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="journal-prompt__page-field" aria-label="Completed pages" ref={pageFieldRef}>
        {visiblePages.map((page, visibleIndex) => {
          const placement = pagePlacements[page.slot % pagePlacements.length];
          const scatter = pageScatter(page.id);
          const pageIndex = pages.indexOf(page);
          // Every archived sheet is the same physical object. Placement may
          // change its position and rotation, but never its dimensions.
          const restingScale = restingPaperScale;
          const pageRotation = Number.parseFloat(placement.rotation) + scatter.rotation;
          const deskShadow = localDeskShadow(pageRotation, restingScale);
          const tidyX = (visibleIndex - (visiblePages.length - 1) / 2) * tidyStepX;
          const tidyY = visibleIndex * 11;
          const tidyBaseRotation = [-0.18, 0.12, -0.08, 0.15, -0.04][visibleIndex % 5];
          const tidyRotationValue = tidyBaseRotation;
          const tidyRotation = `${tidyRotationValue.toFixed(2)}deg`;
          const tidyShadow = localDeskShadow(tidyRotationValue, 0.84);
          const tidyMobileX = (visibleIndex - (visiblePages.length - 1) / 2) * tidyMobileStepX;
          const isReturnTarget = returningPaperId === page.id;
          // The picked sheet is transferred to the writing stage. Keeping a
          // second faded rendering on the desk makes the interaction read as
          // a copy, especially while the pickup animation is in flight.
          // On return, only its empty destination shadow is reserved so the
          // physical sheet has somewhere visible to settle without a snap.
          if (activeArchivedId === page.id && !isReturnTarget) return null;
          return (
            <button
              aria-hidden={isReturnTarget || undefined}
              aria-label={`Pick up page ${pageIndex + 1}`}
              className="journal-prompt__archived-page"
              data-dragging={draggingPageId === page.id}
              data-initial-entry={pageIndex >= 3 && initialDeskEntry ? "true" : undefined}
              data-page-id={page.id}
              data-releasing={page.id === releasingPageId}
              data-return-target={isReturnTarget || undefined}
              key={page.id}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                openArchivedPage(page.id, event.currentTarget);
              }}
              onPointerCancel={(event) => {
                const drag = pageDragRef.current;
                if (!drag || drag.id !== page.id || drag.pointerId !== event.pointerId) return;
                drag.element.style.setProperty("--page-drag-x", `${drag.originX}px`);
                drag.element.style.setProperty("--page-drag-y", `${drag.originY}px`);
                placeArchivedIndex(drag.element, drag.startRect);
                pageDragRef.current = null;
                setDraggingPageId(null);
                window.requestAnimationFrame(() => {
                  drag.element.style.setProperty("--page-drag-rotation", "0deg");
                });
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const element = event.currentTarget;
                const immediateOrder = nextDeskOrder(pages);
                element.style.setProperty("--page-layer", String(immediateOrder));
                element.setPointerCapture(event.pointerId);
                setPages((current) => {
                  const raisedOrder = Math.max(immediateOrder, nextDeskOrder(current));
                  return current.map((entry) => (
                    entry.id === page.id ? { ...entry, deskOrder: raisedOrder } : entry
                  ));
                });
                pageDragRef.current = {
                  element,
                  id: page.id,
                  lastAt: performance.now(),
                  lastClientX: event.clientX,
                  moved: false,
                  originX: page.deskX ?? 0,
                  originY: page.deskY ?? 0,
                  pointerId: event.pointerId,
                  startRect: element.getBoundingClientRect(),
                  startX: event.clientX,
                  startY: event.clientY,
                  tilt: 0,
                };
                placeArchivedIndex(element);
                setDraggingPageId(page.id);
              }}
              onPointerMove={(event) => {
                const drag = pageDragRef.current;
                if (!drag || drag.id !== page.id || drag.pointerId !== event.pointerId) return;
                const rawX = event.clientX - drag.startX;
                const rawY = event.clientY - drag.startY;
                if (Math.hypot(rawX, rawY) > 4) drag.moved = true;
                const delta = clampedPageDelta(drag.startRect, rawX, rawY);
                drag.element.style.setProperty("--page-drag-x", `${drag.originX + delta.x}px`);
                drag.element.style.setProperty("--page-drag-y", `${drag.originY + delta.y}px`);
                placeArchivedIndex(drag.element, drag.startRect, delta.x);
                const now = performance.now();
                const elapsed = Math.max(8, now - drag.lastAt);
                const horizontalVelocity = (event.clientX - drag.lastClientX) / elapsed;
                const targetTilt = Math.max(-1.05, Math.min(1.05, horizontalVelocity * 2.65));
                const smoothing = 1 - Math.exp(-elapsed / 68);
                drag.tilt += (targetTilt - drag.tilt) * smoothing;
                drag.element.style.setProperty("--page-drag-rotation", `${drag.tilt.toFixed(2)}deg`);
                drag.lastAt = now;
                drag.lastClientX = event.clientX;
              }}
              onPointerUp={(event) => {
                const drag = pageDragRef.current;
                if (!drag || drag.id !== page.id || drag.pointerId !== event.pointerId) return;
                const rawX = event.clientX - drag.startX;
                const rawY = event.clientY - drag.startY;
                const delta = clampedPageDelta(drag.startRect, rawX, rawY);
                placeArchivedIndex(drag.element, drag.startRect, delta.x);
                if (drag.moved) {
                  setPages((current) => current.map((entry) => (
                    entry.id === page.id
                      ? { ...entry, deskX: drag.originX + delta.x, deskY: drag.originY + delta.y }
                      : entry
                  )));
                }
                if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId);
                pageDragRef.current = null;
                setDraggingPageId(null);
                if (!drag.moved) openArchivedPage(page.id, drag.element);
                window.requestAnimationFrame(() => {
                  drag.element.style.setProperty("--page-drag-rotation", "0deg");
                });
              }}
              type="button"
              style={{
                "--page-drag-x": `${page.deskX ?? 0}px`,
                "--page-drag-y": `${page.deskY ?? 0}px`,
                "--page-drag-rotation": "0deg",
                "--page-layer": page.deskOrder ?? pageIndex + 1,
                "--page-mobile-scale": Math.max(0.42, restingScale * 0.7),
                "--page-rotation": `${pageRotation.toFixed(2)}deg`,
                "--page-scale": restingScale,
                "--page-shadow-x": `${deskShadow.x.toFixed(2)}px`,
                "--page-shadow-y": `${deskShadow.y.toFixed(2)}px`,
                "--page-tidy-mobile-x": `${tidyMobileX}px`,
                "--page-tidy-delay": `${Math.min(visibleIndex * 14, 84)}ms`,
                "--page-tidy-rotation": tidyRotation,
                "--page-tidy-shadow-x": `${tidyShadow.x.toFixed(2)}px`,
                "--page-tidy-shadow-y": `${tidyShadow.y.toFixed(2)}px`,
                "--page-tidy-x": `${tidyX}px`,
                "--page-tidy-y": `${tidyY}px`,
                "--page-x": `calc(${placement.x} + ${scatter.x.toFixed(2)}vw)`,
                "--page-y": `calc(${placement.y} + ${scatter.y.toFixed(2)}vh)`,
                "--page-entry-delay": `${Math.max(0, pageIndex - 3) * 45}ms`,
                viewTransitionName: pageIndex < 3 ? `field-note-page-${pageIndex + 1}` : "none",
              } as React.CSSProperties}
            >
              <i aria-hidden="true" className="journal-prompt__archived-shadow" />
              {!isReturnTarget ? (
                <>
                  <InkedPagePreview page={page} pageNumber={pageIndex + 1} showIndex={false} strokes={highlightStrokesByPage.get(page.id) ?? []} />
                  <span aria-hidden="true" className="journal-prompt__archived-page-index">
                    {String(pageIndex + 1).padStart(2, "0")}
                  </span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>

      <main className="journal-prompt__stage">
        {showPromptCard ? (
          <aside className="journal-prompt__prompt-card">
            <h1>{prompt}</h1>
          </aside>
        ) : null}

        <div className="journal-prompt__paper-viewport">
          <div
            className="journal-prompt__paper-stack journal-prompt__paper-stack--live"
            data-covered={Boolean(activeArchivedPage) && !returningPaperId}
            data-initial-entry={pageCycle === 0 ? "true" : undefined}
            data-page-number={String(meaningfulPages.length + 1).padStart(2, "0")}
            key={`live-${pageCycle}`}
            ref={paperRef}
          >
            <i aria-hidden="true" className="journal-prompt__paper-shadow journal-prompt__paper-shadow--ambient" />
            <section
              className="journal-prompt__paper"
              data-page-id={livePageId}
              onClick={(event) => {
                if (highlighterActive) return;
                if (activeArchivedPage) {
                  event.stopPropagation();
                  returnToLivePage();
                  return;
                }
                const textarea = event.currentTarget.querySelector("textarea");
                if (event.target === textarea) return;
                if (!textarea) return;
                textarea.focus({ preventScroll: true });
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
              }}
            >
              {answer.trim() || livePageHasInk ? <span className="journal-prompt__sheet-index" aria-hidden="true">{String(meaningfulPages.length + 1).padStart(2, "0")}</span> : null}
              <div className="journal-prompt__writing-field">
                <textarea
                  aria-label="Your response"
                  aria-hidden={Boolean(activeArchivedPage)}
                  onChange={(event) => {
                    editedPageRef.current = livePageId;
                    setAnswer(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    soundRef.current?.press(event.nativeEvent);
                    if (event.key === "Backspace" && openPreviousPage(event.currentTarget)) {
                      event.preventDefault();
                      return;
                    }
                    if (event.key === "Enter") bumpPaper();
                  }}
                  onKeyUp={(event) => soundRef.current?.release(event.nativeEvent)}
                  placeholder="Start wherever you are…"
                  ref={activeArchivedPage ? undefined : textareaRef}
                  spellCheck
                  tabIndex={activeArchivedPage ? -1 : 0}
                  value={answer}
                />
              </div>
              <JournalInkLayer
                active={highlighterActive && !activeArchivedPage}
                erasing={eraserActive && !activeArchivedPage}
                onCommit={commitHighlight}
                onEraseCommit={eraseHighlights}
                onStrokeMotion={soundHighlightMotion}
                onWetChange={soundHighlightWetChange}
                pageId={livePageId}
                strokes={highlightStrokes}
              />
              <button
                className="journal-prompt__continue-page"
                disabled={(!answer.trim() && !livePageHasInk) || Boolean(activeArchivedPage)}
                onClick={(event) => {
                  event.stopPropagation();
                  continueOnNewPage();
                }}
                type="button"
              >
                Continue on new page
                <CaretRightIcon aria-hidden="true" size={13} weight="bold" />
              </button>
            </section>
          </div>
          {activeArchivedPage ? (
            <div className="journal-prompt__paper-stack journal-prompt__paper-stack--picked" key={activeArchivedPage.id} ref={pickedUpPaperRef}>
              <i aria-hidden="true" className="journal-prompt__paper-shadow journal-prompt__paper-shadow--picked" />
              <i aria-hidden="true" className="journal-prompt__return-contact-shadow" />
              <section
                className="journal-prompt__paper"
                data-motion-face={returningPaperId === activeArchivedPage.id}
                data-page-id={activeArchivedPage.id}
                data-picked-up="true"
              >
                {returningPaperId === activeArchivedPage.id ? (
                  <InkedPagePreview page={activeArchivedPage} pageNumber={activePageNumber} strokes={highlightStrokesByPage.get(activeArchivedPage.id) ?? []} />
                ) : null}
                {activeArchivedPage.text.trim() || highlightStrokesByPage.get(activeArchivedPage.id)?.length ? <span className="journal-prompt__sheet-index" aria-hidden="true">{String(activePageNumber).padStart(2, "0")}</span> : null}
                <div className="journal-prompt__writing-field">
                  <textarea
                    aria-label={`Edit page ${activePageNumber}`}
                    onChange={(event) => updateEditorValue(event.target.value)}
                    onKeyDown={(event) => {
                      soundRef.current?.press(event.nativeEvent);
                      if (event.key === "Escape") {
                        event.preventDefault();
                        returnToLivePage();
                      } else if (event.key === "Enter") bumpPaper();
                    }}
                    onKeyUp={(event) => soundRef.current?.release(event.nativeEvent)}
                    ref={textareaRef}
                    spellCheck
                    value={activeArchivedPage.text}
                  />
                </div>
                <JournalInkLayer
                  active={highlighterActive && returningPaperId !== activeArchivedPage.id}
                  erasing={eraserActive && returningPaperId !== activeArchivedPage.id}
                  onCommit={commitHighlight}
                  onEraseCommit={eraseHighlights}
                  onStrokeMotion={soundHighlightMotion}
                  onWetChange={soundHighlightWetChange}
                  pageId={activeArchivedPage.id}
                  strokes={highlightStrokes}
                />
                <button className="journal-prompt__continue-page" data-action="return" onClick={(event) => { event.stopPropagation(); returnToLivePage(); }} type="button">
                  <ArrowUUpLeftIcon aria-hidden="true" size={13} weight="bold" />
                  Return to current page
                </button>
              </section>
            </div>
          ) : null}
        </div>

        {highlighterRendered ? (
          <PhysicalHighlighter
            active={highlighterActive}
            initialEntry={initialDeskEntry}
            onToggle={() => {
              const nextActive = !highlighterActive;
              if (nextActive) soundRef.current?.markerOpen();
              else soundRef.current?.markerClose();
              if (nextActive) setEraserActive(false);
              setHighlighterActive(nextActive);
              if (nextActive) textareaRef.current?.blur();
              if (!nextActive) window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
            }}
            visible={highlighterVisible}
          />
        ) : null}

        {eraserActive ? (
          <PhysicalEraser
            onPutDown={() => {
              setEraserActive(false);
              window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
            }}
          />
        ) : null}

        {activeArchivedPage || deletedPage || onArchiveNotebook ? <div className="journal-prompt__page-tools" aria-label="Page tools" role="toolbar">
          {activeArchivedPage ? (
            <>
              <button aria-label="Return to current page" onClick={returnToLivePage} title="Current page" type="button"><ArrowUUpLeftIcon aria-hidden="true" size={17} />Current page</button>
              <button aria-label="Delete this page" onClick={deleteActivePage} title="Delete page" type="button"><TrashIcon aria-hidden="true" size={17} />Delete page</button>
            </>
          ) : deletedPage ? (
            <button aria-label="Undo deleted page" onClick={undoDelete} title="Undo delete" type="button"><ArrowCounterClockwiseIcon aria-hidden="true" size={17} />Undo delete</button>
          ) : null}
          {onArchiveNotebook ? <button aria-label="Archive notebook" onClick={onArchiveNotebook} title="Archive notebook" type="button"><ArchiveIcon aria-hidden="true" size={17} />Archive</button> : null}
        </div> : null}

        <div className="journal-prompt__tools" aria-label="Writing tools" ref={toolMenuRef}>
          {onHome && toolMenuOpen ? (
            <div className="journal-prompt__tool-popover" role="menu">
              <button aria-label="Go to notebook cover" onClick={() => { setToolMenuOpen(false); onHome(); }} role="menuitem" type="button">
                <HouseIcon aria-hidden="true" size={17} />
                <span>Home</span>
              </button>
            </div>
          ) : null}
          <div className="journal-prompt__tool-menu" role="toolbar">
            <button
              aria-label={eraserActive ? "Stop erasing" : "Erase highlights"}
              aria-pressed={eraserActive}
              data-help={eraserActive ? "Stop erasing" : "Erase"}
              data-tool="eraser"
              disabled={!eraserActive && !highlightStrokesByPage.get(activeArchivedId ?? livePageId)?.length}
              onClick={() => {
                const nextActive = !eraserActive;
                if (nextActive && highlighterActive) soundRef.current?.markerClose();
                setHighlighterActive(false);
                setEraserActive(nextActive);
                if (nextActive) textareaRef.current?.blur();
                else window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
              }}
              type="button"
            >
              <EraserIcon aria-hidden="true" size={18} />
            </button>
            <button
              aria-label={deskTidy ? "Tidy and realign pages again" : "Arrange pages into a tidy desk"}
              aria-pressed={deskTidy}
              data-help={deskTidy ? "Re-tidy pages" : "Tidy desk"}
              data-tool="tidy"
              disabled={!pages.length}
              onClick={toggleDeskOrder}
              type="button"
            >
              <SquaresFourIcon aria-hidden="true" size={18} />
            </button>
            <button aria-label="Keep a copy" data-help="Keep a copy" data-tool="keep" disabled={!exportSheets.length} onClick={() => { setExportPageIndex(0); setExportTurningIndex(null); setExportPreviewOpen(true); }} type="button"><HugeiconsIcon aria-hidden="true" color="currentColor" icon={Notebook01Icon} size={18} strokeWidth={1.5} /></button>
            {onHome ? (
              <button aria-expanded={toolMenuOpen} aria-haspopup="menu" aria-label="Open menu" data-help="Menu" data-tool="menu" onClick={() => setToolMenuOpen((open) => !open)} type="button">
                <ListIcon aria-hidden="true" size={19} />
              </button>
            ) : null}
          </div>
        </div>
      </main>

      {releasingPage && releaseSource ? (
        <div
          aria-hidden="true"
          className="journal-prompt__release-sheet"
          ref={releaseSheetRef}
          style={{
            height: `${releaseSource.visualHeight}px`,
            left: `${releaseSource.centerX - releaseSource.visualWidth / 2}px`,
            top: `${releaseSource.centerY - releaseSource.visualHeight / 2}px`,
            width: `${releaseSource.visualWidth}px`,
          }}
        >
          <i className="journal-prompt__release-shadow" />
          <div className="journal-prompt__release-face">
            <InkedPagePreview
              densityCap={2}
              page={releasingPage}
              pageNumber={releasingPageIndex + 1}
              strokes={highlightStrokesByPage.get(releasingPage.id) ?? []}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
