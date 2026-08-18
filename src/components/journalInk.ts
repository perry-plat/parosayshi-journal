export const PAGE_WIDTH = 480;
export const PAGE_HEIGHT = 679;
export const PDF_WIDTH = 2480;
export const PDF_HEIGHT = 3508;
export const HIGHLIGHT_COLOR = "#fff01f";

export const PAGE_TEXT = {
  fontSize: 9.98,
  insetBottom: 45,
  insetTop: 48,
  insetX: 60,
  letterSpacing: -0.12,
  lineHeight: 13.92,
} as const;

export type HighlightPoint = {
  x: number;
  y: number;
  t: number;
  pressure?: number;
};

export type HighlightStroke = {
  angle: number;
  brushVersion: 1;
  color: string;
  committedAt: number;
  id: string;
  pageId: string;
  points: HighlightPoint[];
  seed: number;
  width: number;
};

export type JournalPageRender = {
  id: string;
  text: string;
};

function renderedHighlightColor(color: string) {
  return ["#78e63f", "#f1df45"].includes(color.toLowerCase()) ? HIGHLIGHT_COLOR : color;
}

type RenderPageOptions = {
  page: JournalPageRender;
  pageNumber: number;
  showIndex?: boolean;
  strokes?: HighlightStroke[];
  tone?: "archived" | "fresh";
};

const INK_DB = "field-notes-journal-ink";
const INK_STORE = "strokes";

export function createJournalId(prefix = "sheet") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function canvasTextLines(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
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

function paintPaper(context: CanvasRenderingContext2D, pageId: string) {
  const paper = context.createLinearGradient(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  paper.addColorStop(0, "#ffffff");
  paper.addColorStop(0.62, "#fefefe");
  paper.addColorStop(1, "#fafafa");
  context.fillStyle = paper;
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

  const seed = hashString(pageId);
  const flecks = Math.round((PAGE_WIDTH * PAGE_HEIGHT) / 560);
  for (let index = 0; index < flecks; index += 1) {
    const hash = Math.imul(seed ^ (index + 17), 2246822519) >>> 0;
    const x = (hash & 65535) / 65535 * PAGE_WIDTH;
    const y = ((hash >>> 16) & 65535) / 65535 * PAGE_HEIGHT;
    const radius = 0.18 + ((hash >>> 6) & 31) / 31 * 0.42;
    context.fillStyle = (hash & 1) === 0 ? "rgb(72 67 60 / 0.04)" : "rgb(255 255 255 / 0.13)";
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  context.lineCap = "round";
  for (let index = 0; index < 54; index += 1) {
    const hash = Math.imul(seed ^ (index + 701), 3266489917) >>> 0;
    const x = (hash & 65535) / 65535 * PAGE_WIDTH;
    const y = ((hash >>> 16) & 65535) / 65535 * PAGE_HEIGHT;
    const length = 7 + ((hash >>> 7) & 63) / 63 * 26;
    const rise = (((hash >>> 13) & 31) / 31 - 0.5) * 2.2;
    context.strokeStyle = (hash & 1) === 0 ? "rgb(70 63 55 / 0.035)" : "rgb(255 255 255 / 0.11)";
    context.lineWidth = 0.22 + ((hash >>> 20) & 15) / 15 * 0.25;
    context.beginPath();
    context.moveTo(x, y);
    context.quadraticCurveTo(x + length * 0.46, y + rise, x + length, y + rise * 0.35);
    context.stroke();
  }
}

function paintText(
  context: CanvasRenderingContext2D,
  page: JournalPageRender,
  pageNumber: number,
  showIndex: boolean,
  tone: "archived" | "fresh",
) {
  const seed = hashString(page.id);
  context.textBaseline = "alphabetic";
  if (showIndex) {
    context.textAlign = "right";
    context.font = '400 7px "Geist Mono Variable", "Geist Mono", monospace';
    context.fillStyle = "rgb(45 40 35 / 0.72)";
    context.fillText(String(pageNumber).padStart(2, "0"), PAGE_WIDTH - 10, 16);
  }

  context.textAlign = "left";
  context.font = `300 ${PAGE_TEXT.fontSize}px "Geist Mono Variable", "Geist Mono", monospace`;
  const metrics = context.measureText("Mg");
  const baselineOffset = (PAGE_TEXT.lineHeight - PAGE_TEXT.fontSize) / 2 + metrics.actualBoundingBoxAscent;
  const lines = canvasTextLines(context, page.text, PAGE_WIDTH - PAGE_TEXT.insetX * 2);
  lines.forEach((line, lineIndex) => {
    const baseline = PAGE_TEXT.insetTop + baselineOffset + lineIndex * PAGE_TEXT.lineHeight;
    if (baseline > PAGE_HEIGHT - PAGE_TEXT.insetBottom) return;
    let x = PAGE_TEXT.insetX;
    Array.from(line).forEach((character, characterIndex) => {
      const characterWidth = context.measureText(character).width + PAGE_TEXT.letterSpacing;
      if (character.trim()) {
        const imprintIndex = lineIndex * 127 + characterIndex;
        const hash = Math.imul(seed ^ (imprintIndex + 1), 2654435761) >>> 0;
        context.globalAlpha = tone === "fresh"
          ? 0.8 + ((hash >>> 16) & 255) / 255 * 0.08
          : 0.7 + ((hash >>> 16) & 255) / 255 * 0.1;
        context.fillStyle = tone === "fresh" ? "#292622" : "#35312d";
        context.shadowColor = "transparent";
        context.shadowBlur = 0;
        context.fillText(character, x, baseline);
      }
      x += characterWidth;
    });
  });
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

type ChiselPoint = Pick<HighlightPoint, "x" | "y">;

function smoothChiselPoints(points: HighlightPoint[]) {
  let smoothed: ChiselPoint[] = points.map(({ x, y }) => ({ x, y }));
  for (let pass = 0; pass < 2; pass += 1) {
    if (smoothed.length < 3) break;
    const next: ChiselPoint[] = [smoothed[0]];
    for (let index = 0; index < smoothed.length - 1; index += 1) {
      const current = smoothed[index];
      const following = smoothed[index + 1];
      next.push(
        { x: current.x * 0.75 + following.x * 0.25, y: current.y * 0.75 + following.y * 0.25 },
        { x: current.x * 0.25 + following.x * 0.75, y: current.y * 0.25 + following.y * 0.75 },
      );
    }
    next.push(smoothed.at(-1)!);
    smoothed = next;
  }
  return smoothed;
}

function chiselCorners(point: ChiselPoint, width: number, angle: number, depthRatio = 0.19) {
  const halfWidth = width / 2;
  const halfDepth = width * depthRatio;
  const broadX = Math.sin(angle) * halfWidth;
  const broadY = Math.cos(angle) * halfWidth;
  const depthX = Math.cos(angle) * halfDepth;
  const depthY = -Math.sin(angle) * halfDepth;
  return [
    { x: point.x + broadX + depthX, y: point.y + broadY + depthY },
    { x: point.x + broadX - depthX, y: point.y + broadY - depthY },
    { x: point.x - broadX - depthX, y: point.y - broadY - depthY },
    { x: point.x - broadX + depthX, y: point.y - broadY + depthY },
  ];
}

function traceChiselDeposit(
  context: CanvasRenderingContext2D,
  point: ChiselPoint,
  width: number,
  angle: number,
  depthRatio = 0.12,
) {
  const corners = chiselCorners(point, width, angle, depthRatio);
  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach((corner) => context.lineTo(corner.x, corner.y));
  context.closePath();
}

function traceEndpointPool(
  context: CanvasRenderingContext2D,
  endpoint: ChiselPoint,
  inwardPoint: ChiselPoint,
  width: number,
  angle: number,
  lengthRatio: number,
  tipScale: number,
) {
  const distance = Math.hypot(inwardPoint.x - endpoint.x, inwardPoint.y - endpoint.y);
  const direction = distance > 0.001
    ? { x: (inwardPoint.x - endpoint.x) / distance, y: (inwardPoint.y - endpoint.y) / distance }
    : { x: Math.cos(angle), y: -Math.sin(angle) };
  const inner = {
    x: endpoint.x + direction.x * width * lengthRatio,
    y: endpoint.y + direction.y * width * lengthRatio,
  };
  const hull = convexHull([
    ...chiselCorners(endpoint, width * tipScale, angle, 0.13),
    ...chiselCorners(inner, width, angle, 0.09),
  ]);
  context.beginPath();
  context.moveTo(hull[0].x, hull[0].y);
  hull.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
}

function convexHull(points: ChiselPoint[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (origin: ChiselPoint, a: ChiselPoint, b: ChiselPoint) =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower: ChiselPoint[] = [];
  sorted.forEach((point) => {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  });
  const upper: ChiselPoint[] = [];
  [...sorted].reverse().forEach((point) => {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  });
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function traceChiselStroke(context: CanvasRenderingContext2D, stroke: HighlightStroke) {
  const points = smoothChiselPoints(stroke.points);
  let travelled = 0;
  context.beginPath();
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const variation = Math.sin((travelled + stroke.seed % 89) * 0.071) * 0.24
      + Math.sin((travelled + stroke.seed % 47) * 0.137) * 0.1;
    const nextTravelled = travelled + Math.hypot(next.x - current.x, next.y - current.y);
    const nextVariation = Math.sin((nextTravelled + stroke.seed % 89) * 0.071) * 0.24
      + Math.sin((nextTravelled + stroke.seed % 47) * 0.137) * 0.1;
    const hull = convexHull([
      ...chiselCorners(current, stroke.width + variation, stroke.angle),
      ...chiselCorners(next, stroke.width + nextVariation, stroke.angle),
    ]);
    context.moveTo(hull[0].x, hull[0].y);
    hull.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.closePath();
    travelled = nextTravelled;
  }
}

export function drawHighlightStroke(context: CanvasRenderingContext2D, stroke: HighlightStroke) {
  if (stroke.brushVersion !== 1 || stroke.points.length < 2) return;
  context.save();
  context.globalCompositeOperation = "multiply";
  context.beginPath();
  context.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.clip();

  context.fillStyle = renderedHighlightColor(stroke.color);
  context.globalAlpha = 0.28;
  traceChiselStroke(context, stroke);
  context.fill();

  const smoothedPoints = smoothChiselPoints(stroke.points);
  context.globalAlpha = 0.09;
  traceEndpointPool(
    context,
    smoothedPoints[0],
    smoothedPoints[1],
    stroke.width,
    stroke.angle,
    0.48,
    1.015,
  );
  context.fill();

  context.globalAlpha = 0.065;
  traceChiselDeposit(context, smoothedPoints[0], stroke.width * 0.98, stroke.angle);
  context.fill();

  context.globalAlpha = 0.13;
  traceEndpointPool(
    context,
    smoothedPoints.at(-1)!,
    smoothedPoints.at(-2)!,
    stroke.width,
    stroke.angle,
    0.7,
    1.045,
  );
  context.fill();

  context.globalAlpha = 0.085;
  traceChiselDeposit(context, smoothedPoints.at(-1)!, stroke.width * 1.02, stroke.angle, 0.14);
  context.fill();
  context.restore();
}

export function renderJournalPage(context: CanvasRenderingContext2D, options: RenderPageOptions) {
  const { page, pageNumber, showIndex = true, strokes = [], tone = "archived" } = options;
  const scaleX = context.canvas.width / PAGE_WIDTH;
  const scaleY = context.canvas.height / PAGE_HEIGHT;
  context.save();
  context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  context.clearRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  paintPaper(context, page.id);
  paintText(context, page, pageNumber, showIndex, tone);
  strokes.filter((stroke) => stroke.pageId === page.id).forEach((stroke) => drawHighlightStroke(context, stroke));
  context.restore();
}

function openInkDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(INK_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(INK_STORE, { keyPath: "id" });
      store.createIndex("pageId", "pageId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the local ink store."));
  });
}

export async function loadHighlightStrokes() {
  const database = await openInkDatabase();
  return new Promise<HighlightStroke[]>((resolve, reject) => {
    const transaction = database.transaction(INK_STORE, "readonly");
    const request = transaction.objectStore(INK_STORE).getAll();
    request.onsuccess = () => resolve((request.result as HighlightStroke[]).filter((stroke) => stroke.brushVersion === 1));
    request.onerror = () => reject(request.error ?? new Error("Unable to read the local ink store."));
    transaction.oncomplete = () => database.close();
  });
}

export async function persistHighlightStroke(stroke: HighlightStroke) {
  const database = await openInkDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(INK_STORE, "readwrite");
    transaction.objectStore(INK_STORE).put(stroke);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Unable to file this highlight locally."));
    };
  });
}

export async function removePageHighlights(pageId: string) {
  const database = await openInkDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(INK_STORE, "readwrite");
    const index = transaction.objectStore(INK_STORE).index("pageId");
    const request = index.openKeyCursor(IDBKeyRange.only(pageId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      transaction.objectStore(INK_STORE).delete(cursor.primaryKey);
      cursor.continue();
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Unable to remove the sheet ink."));
    };
  });
}
