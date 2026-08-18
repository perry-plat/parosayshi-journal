import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  createJournalId,
  drawHighlightStroke,
  HIGHLIGHT_COLOR,
  highlightStrokeIntersectsSegment,
  hashString,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type HighlightPoint,
  type HighlightStroke,
} from "./journalInk";

type JournalInkLayerProps = {
  active: boolean;
  erasing?: boolean;
  onCommit: (stroke: HighlightStroke) => void;
  onEraseCommit?: (strokeIds: string[]) => void;
  onStrokeMotion?: (motion: HighlighterMotion) => void;
  onWetChange?: (wet: boolean) => void;
  pageId: string;
  strokes: HighlightStroke[];
};

export type HighlighterMotion = {
  acceleration: number;
  pressure: number;
  speed: number;
  turn: number;
};

type WetStroke = HighlightStroke & {
  distance: number;
  pointerId: number;
};

type EraseGesture = {
  lastPoint: HighlightPoint;
  pendingIds: Set<string>;
  pointerId: number;
};

function pointerPoint(event: PointerEvent | React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): HighlightPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    pressure: event.pointerType === "mouse" || !event.pressure ? 0.5 : event.pressure,
    t: event.timeStamp,
    x: Math.max(0, Math.min(PAGE_WIDTH, (event.clientX - rect.left) / Math.max(1, rect.width) * PAGE_WIDTH)),
    y: Math.max(0, Math.min(PAGE_HEIGHT, (event.clientY - rect.top) / Math.max(1, rect.height) * PAGE_HEIGHT)),
  };
}

export function JournalInkLayer({ active, erasing = false, onCommit, onEraseCommit, onStrokeMotion, onWetChange, pageId, strokes }: JournalInkLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const lastDirectionRef = useRef<{ x: number; y: number } | null>(null);
  const lastMotionAtRef = useRef(0);
  const lastSpeedRef = useRef(0);
  const wetRef = useRef<WetStroke | null>(null);
  const eraseRef = useRef<EraseGesture | null>(null);

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const density = Math.min(window.devicePixelRatio || 1, 2.5);
    const width = Math.max(1, Math.round(rect.width * density));
    const height = Math.max(1, Math.round(rect.height * density));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(width / PAGE_WIDTH, 0, 0, height / PAGE_HEIGHT, 0, 0);
    context.clearRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    const pendingIds = eraseRef.current?.pendingIds;
    strokes
      .filter((stroke) => stroke.pageId === pageId)
      .forEach((stroke) => drawHighlightStroke(context, stroke, pendingIds?.has(stroke.id) ? 0.16 : 1));
    if (wetRef.current) drawHighlightStroke(context, wetRef.current);
  }, [pageId, strokes]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(draw);
  }, [draw]);

  const cancelWetStroke = useCallback(() => {
    const wet = wetRef.current;
    const canvas = canvasRef.current;
    if (wet && canvas?.hasPointerCapture(wet.pointerId)) canvas.releasePointerCapture(wet.pointerId);
    wetRef.current = null;
    onStrokeMotion?.({ acceleration: 0, pressure: 0, speed: 0, turn: 0 });
    onWetChange?.(false);
    scheduleDraw();
  }, [onStrokeMotion, onWetChange, scheduleDraw]);

  const cancelEraseGesture = useCallback(() => {
    const gesture = eraseRef.current;
    const canvas = canvasRef.current;
    if (gesture && canvas?.hasPointerCapture(gesture.pointerId)) canvas.releasePointerCapture(gesture.pointerId);
    eraseRef.current = null;
    scheduleDraw();
  }, [scheduleDraw]);

  const collectEraseHits = useCallback((start: HighlightPoint, end: HighlightPoint) => {
    const gesture = eraseRef.current;
    if (!gesture) return;
    strokes.forEach((stroke) => {
      if (
        stroke.pageId === pageId
        && !gesture.pendingIds.has(stroke.id)
        && highlightStrokeIntersectsSegment(stroke, start, end)
      ) {
        gesture.pendingIds.add(stroke.id);
      }
    });
  }, [pageId, strokes]);

  useLayoutEffect(() => {
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const initialRect = canvas.getBoundingClientRect();
    let lastWidth = initialRect.width;
    let lastHeight = initialRect.height;
    const observer = new ResizeObserver((entries) => {
      const nextRect = entries[0]?.contentRect;
      if (!nextRect) return;
      const changed = Math.abs(nextRect.width - lastWidth) > 0.5 || Math.abs(nextRect.height - lastHeight) > 0.5;
      lastWidth = nextRect.width;
      lastHeight = nextRect.height;
      if (!changed) return;
      cancelWetStroke();
      cancelEraseGesture();
      scheduleDraw();
    });
    observer.observe(canvas);
    const cancelPointerWork = () => {
      cancelWetStroke();
      cancelEraseGesture();
    };
    window.addEventListener("blur", cancelPointerWork);
    window.addEventListener("orientationchange", cancelPointerWork);
    return () => {
      observer.disconnect();
      window.removeEventListener("blur", cancelPointerWork);
      window.removeEventListener("orientationchange", cancelPointerWork);
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [cancelEraseGesture, cancelWetStroke, scheduleDraw]);

  useEffect(() => {
    if (!active) cancelWetStroke();
  }, [active, cancelWetStroke]);

  useEffect(() => {
    if (!erasing) cancelEraseGesture();
  }, [cancelEraseGesture, erasing]);

  return (
    <canvas
      aria-hidden="true"
      className="journal-prompt__ink-layer"
      data-active={active || erasing}
      data-tool={erasing ? "eraser" : active ? "highlighter" : "none"}
      onPointerCancel={() => {
        cancelWetStroke();
        cancelEraseGesture();
      }}
      onPointerDown={(event) => {
        if ((!active && !erasing) || event.button !== 0) return;
        event.preventDefault();
        const canvas = event.currentTarget;
        canvas.setPointerCapture(event.pointerId);
        if (erasing) {
          const point = pointerPoint(event, canvas);
          eraseRef.current = {
            lastPoint: point,
            pendingIds: new Set(),
            pointerId: event.pointerId,
          };
          collectEraseHits(point, point);
          scheduleDraw();
          return;
        }
        lastDirectionRef.current = null;
        lastMotionAtRef.current = event.timeStamp;
        lastSpeedRef.current = 0;
        const id = createJournalId("mark");
        const seed = hashString(id);
        wetRef.current = {
          angle: -0.145 + ((seed & 255) / 255 - 0.5) * 0.035,
          brushVersion: 1,
          color: HIGHLIGHT_COLOR,
          committedAt: 0,
          distance: 0,
          id,
          pageId,
          pointerId: event.pointerId,
          points: [pointerPoint(event, canvas)],
          seed,
          width: 16,
        };
        onWetChange?.(true);
      }}
      onPointerMove={(event) => {
        const eraseGesture = eraseRef.current;
        if (erasing && eraseGesture?.pointerId === event.pointerId) {
          event.preventDefault();
          const canvas = event.currentTarget;
          const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? [];
          const events = coalescedEvents.length ? coalescedEvents : [event.nativeEvent];
          events.forEach((coalesced) => {
            const point = pointerPoint(coalesced, canvas);
            collectEraseHits(eraseGesture.lastPoint, point);
            eraseGesture.lastPoint = point;
          });
          scheduleDraw();
          return;
        }
        const wet = wetRef.current;
        if (!active || !wet || wet.pointerId !== event.pointerId) return;
        event.preventDefault();
        const canvas = event.currentTarget;
        const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? [];
        const events = coalescedEvents.length ? coalescedEvents : [event.nativeEvent];
        let pressureTotal = 0;
        let sampledSegments = 0;
        let travelled = 0;
        let turnTotal = 0;
        events.forEach((coalesced) => {
          const point = pointerPoint(coalesced, canvas);
          const previous = wet.points.at(-1)!;
          const deltaX = point.x - previous.x;
          const deltaY = point.y - previous.y;
          const distance = Math.hypot(deltaX, deltaY);
          if (distance < 0.55 && point.t - previous.t < 14) return;
          const direction = { x: deltaX / Math.max(distance, 0.001), y: deltaY / Math.max(distance, 0.001) };
          const priorDirection = lastDirectionRef.current;
          if (priorDirection) {
            const dot = Math.max(-1, Math.min(1, direction.x * priorDirection.x + direction.y * priorDirection.y));
            turnTotal += Math.acos(dot) / Math.PI;
          }
          lastDirectionRef.current = direction;
          wet.distance += distance;
          pressureTotal += point.pressure ?? 0.5;
          sampledSegments += 1;
          travelled += distance;
          wet.points.push(point);
        });
        if (travelled > 0) {
          const elapsed = Math.max(8, event.timeStamp - lastMotionAtRef.current);
          const rawSpeed = travelled / elapsed;
          const normalizedSpeed = Math.min(1, rawSpeed / 0.72);
          const acceleration = Math.min(1, Math.abs(normalizedSpeed - lastSpeedRef.current) / 0.55);
          lastMotionAtRef.current = event.timeStamp;
          lastSpeedRef.current = lastSpeedRef.current * 0.58 + normalizedSpeed * 0.42;
          onStrokeMotion?.({
            acceleration,
            pressure: pressureTotal / Math.max(1, sampledSegments),
            speed: lastSpeedRef.current,
            turn: Math.min(1, turnTotal / Math.max(1, sampledSegments) * 2.4),
          });
        }
        scheduleDraw();
      }}
      onPointerUp={(event) => {
        const eraseGesture = eraseRef.current;
        if (erasing && eraseGesture?.pointerId === event.pointerId) {
          event.preventDefault();
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          eraseRef.current = null;
          const strokeIds = [...eraseGesture.pendingIds];
          if (strokeIds.length) onEraseCommit?.(strokeIds);
          scheduleDraw();
          return;
        }
        const wet = wetRef.current;
        if (!active || !wet || wet.pointerId !== event.pointerId) return;
        event.preventDefault();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        wetRef.current = null;
        onStrokeMotion?.({ acceleration: 0, pressure: 0, speed: 0, turn: 0 });
        onWetChange?.(false);
        const committed = wet.distance >= 4.5 && wet.points.length >= 2;
        if (committed) {
          const { distance: _distance, pointerId: _pointerId, ...stroke } = wet;
          onCommit({ ...stroke, committedAt: Date.now() });
        } else {
          scheduleDraw();
        }
      }}
      ref={canvasRef}
    />
  );
}
