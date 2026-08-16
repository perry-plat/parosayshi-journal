import { memo, useEffect, useRef } from "react";
import {
  Dithering,
  GrainGradient,
  MeshGradient,
  PerlinNoise,
  StaticMeshGradient,
  StaticRadialGradient,
} from "@paper-design/shaders-react";

type JournalDeskSurfaceName = "archive-signal" | "charcoal" | "cutting-mat" | "dither" | "drafting-mat" | "ink" | "moss" | "navy-cutting-mat" | "stone" | "sunset" | "olive";

type JournalDeskSurfaceProps = {
  archivedCount: number;
  interactionActive: boolean;
  reducedMotion: boolean;
  surface: JournalDeskSurfaceName;
};

const shaderFrame = {
  className: "journal-prompt__desk-shader",
  height: "100%",
  maxPixelCount: 950_000,
  minPixelRatio: 0.72,
  width: "100%",
} as const;

function DraftingMatSurface({
  interactionActive,
  reducedMotion,
}: Pick<JournalDeskSurfaceProps, "interactionActive" | "reducedMotion">) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const interactionRef = useRef(false);
  const wakeRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    interactionRef.current = interactionActive && !reducedMotion;
    wakeRef.current();
  }, [interactionActive, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;

    let frame = 0;
    let height = window.innerHeight;
    let width = window.innerWidth;
    let intensity = 0;
    const pointer = { x: width * 0.5, y: height * 0.5 };
    const target = { ...pointer };

    const drawLine = (vertical: boolean, position: number, major: boolean) => {
      const length = vertical ? height : width;
      context.beginPath();
      for (let axis = -12; axis <= length + 12; axis += 12) {
        const x = vertical ? position : axis;
        const y = vertical ? axis : position;
        const deltaX = x - pointer.x;
        const deltaY = y - pointer.y;
        const distance = Math.hypot(deltaX, deltaY);
        const proximity = Math.max(0, 1 - distance / 210);
        const pressure = proximity * proximity * intensity;
        const nextX = x + deltaX * 0.038 * pressure;
        const nextY = y + deltaY * 0.038 * pressure;
        if (axis === -12) context.moveTo(nextX, nextY);
        else context.lineTo(nextX, nextY);
      }
      context.strokeStyle = major ? "rgba(225, 235, 226, 0.12)" : "rgba(225, 235, 226, 0.045)";
      context.lineWidth = major ? 1 : 0.7;
      context.stroke();
    };

    const render = () => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#113f36";
      context.fillRect(0, 0, width, height);

      for (let x = 0; x <= width + 24; x += 24) drawLine(true, x, x % 96 === 0);
      for (let y = 0; y <= height + 24; y += 24) drawLine(false, y, y % 96 === 0);

      if (intensity > 0.002) {
        const glow = context.createRadialGradient(pointer.x, pointer.y, 18, pointer.x, pointer.y, 215);
        glow.addColorStop(0, `rgba(220, 236, 223, ${0.055 * intensity})`);
        glow.addColorStop(1, "rgba(220, 236, 223, 0)");
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);
      }

      const edgeShade = context.createRadialGradient(width * 0.5, height * 0.46, 0, width * 0.5, height * 0.46, Math.max(width, height) * 0.72);
      edgeShade.addColorStop(0.48, "rgba(0, 0, 0, 0)");
      edgeShade.addColorStop(1, "rgba(3, 18, 15, 0.19)");
      context.fillStyle = edgeShade;
      context.fillRect(0, 0, width, height);
    };

    const animate = () => {
      frame = 0;
      pointer.x += (target.x - pointer.x) * 0.18;
      pointer.y += (target.y - pointer.y) * 0.18;
      const targetIntensity = interactionRef.current ? 1 : 0;
      intensity += (targetIntensity - intensity) * 0.16;
      render();
      const stillMoving = Math.abs(target.x - pointer.x) > 0.25 || Math.abs(target.y - pointer.y) > 0.25;
      if (stillMoving || Math.abs(targetIntensity - intensity) > 0.008) {
        frame = window.requestAnimationFrame(animate);
      }
    };

    const wake = () => {
      if (!frame) frame = window.requestAnimationFrame(animate);
    };

    const resize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      render();
    };

    const move = (event: PointerEvent) => {
      target.x = event.clientX;
      target.y = event.clientY;
      if (interactionRef.current) wake();
    };

    wakeRef.current = wake;
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("resize", resize);
    resize();

    return () => {
      wakeRef.current = () => undefined;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas aria-hidden="true" className="journal-prompt__drafting-mat" ref={canvasRef} />;
}

function archiveSignalPosition(index: number) {
  const hash = (salt: number) => {
    const value = Math.sin((index + 1) * (12.9898 + salt * 7.233)) * 43758.5453;
    return value - Math.floor(value);
  };
  const edge = index % 4;
  if (edge === 0) return { x: 70 + hash(1) * 860, y: 52 + hash(2) * 96 };
  if (edge === 1) return { x: 828 + hash(1) * 112, y: 92 + hash(2) * 516 };
  if (edge === 2) return { x: 70 + hash(1) * 860, y: 560 + hash(2) * 92 };
  return { x: 55 + hash(1) * 112, y: 92 + hash(2) * 516 };
}

function ArchiveSignalSurface({ archivedCount }: Pick<JournalDeskSurfaceProps, "archivedCount">) {
  const signals = Array.from({ length: Math.min(archivedCount, 48) }, (_, index) => ({
    ...archiveSignalPosition(index),
    index,
  }));

  return (
    <div aria-hidden="true" className="journal-prompt__archive-signal-field">
      <svg preserveAspectRatio="none" viewBox="0 0 1000 700">
        {signals.map((signal) => (
          <g key={signal.index} opacity={0.11 + (signal.index % 4) * 0.025} transform={`translate(${signal.x.toFixed(2)} ${signal.y.toFixed(2)})`}>
            <circle cx="0" cy="0" fill="none" r={7 + (signal.index % 3) * 2} />
            <path d="M -15 0 H 15 M 0 -15 V 15" />
            <circle cx="0" cy="0" fill="currentColor" r="1.4" stroke="none" />
          </g>
        ))}
      </svg>
    </div>
  );
}

export const JournalDeskSurface = memo(function JournalDeskSurface({
  archivedCount,
  interactionActive,
  reducedMotion,
  surface,
}: JournalDeskSurfaceProps) {
  if (surface === "cutting-mat" || surface === "navy-cutting-mat") return null;

  if (surface === "drafting-mat") {
    return <DraftingMatSurface interactionActive={interactionActive} reducedMotion={reducedMotion} />;
  }

  if (surface === "archive-signal") {
    return <ArchiveSignalSurface archivedCount={archivedCount} />;
  }

  if (surface === "dither") {
    return (
      <Dithering
        {...shaderFrame}
        aria-hidden="true"
        colorBack="#101713"
        colorFront="#718071"
        rotation={-8}
        scale={1.12}
        shape="wave"
        size={6}
        speed={reducedMotion ? 0 : 0.055}
        type="8x8"
      />
    );
  }

  if (surface === "ink") {
    return (
      <MeshGradient
        {...shaderFrame}
        aria-hidden="true"
        colors={["#111513", "#26302e", "#60453f", "#7b8176"]}
        distortion={0.86}
        grainMixer={0.08}
        grainOverlay={0.035}
        rotation={18}
        scale={1.06}
        speed={reducedMotion ? 0 : 0.032}
        swirl={0.16}
      />
    );
  }

  if (surface === "moss") {
    return (
      <PerlinNoise
        {...shaderFrame}
        aria-hidden="true"
        colorBack="#18211e"
        colorFront="#6c745f"
        lacunarity={2.2}
        octaveCount={5}
        persistence={0.74}
        proportion={0.56}
        scale={3.4}
        softness={0.42}
        speed={reducedMotion ? 0 : 0.012}
      />
    );
  }

  if (surface === "sunset") {
    return (
      <MeshGradient
        {...shaderFrame}
        aria-hidden="true"
        colors={["#211c20", "#5b3b39", "#9b5e45", "#d08a5f", "#6c6171"]}
        distortion={0.58}
        grainMixer={0.045}
        grainOverlay={0.018}
        rotation={-18}
        scale={1.16}
        speed={reducedMotion ? 0 : 0.014}
        swirl={0.09}
      />
    );
  }

  if (surface === "stone") {
    return (
      <StaticMeshGradient
        {...shaderFrame}
        aria-hidden="true"
        colors={["#777067", "#4a4b47", "#69635d", "#343735"]}
        grainMixer={0.12}
        grainOverlay={0.05}
        mixing={0.72}
        positions={18}
        rotation={244}
        speed={0}
        waveX={0.62}
        waveXShift={0.24}
        waveY={0.8}
        waveYShift={0.58}
      />
    );
  }

  if (surface === "olive") {
    return (
      <GrainGradient
        {...shaderFrame}
        aria-hidden="true"
        colorBack="#1b211d"
        colors={["#53604f", "#313d35", "#725d4d", "#8b7b63"]}
        intensity={0.22}
        noise={0.34}
        rotation={-12}
        scale={1.18}
        shape="wave"
        softness={0.88}
        speed={reducedMotion ? 0 : 0.018}
      />
    );
  }

  return (
    <StaticRadialGradient
      {...shaderFrame}
      aria-hidden="true"
      colorBack="#141715"
      colors={["#222724", "#3c3b37", "#2b2625", "#5c4c43"]}
      distortion={0.46}
      distortionFreq={2.2}
      distortionShift={0.12}
      falloff={0.68}
      focalAngle={214}
      focalDistance={0.34}
      grainMixer={0.1}
      grainOverlay={0.035}
      mixing={0.76}
      radius={1.18}
      scale={1.08}
      speed={0}
    />
  );
});
