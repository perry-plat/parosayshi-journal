import { memo } from "react";

type JournalDeskSurfaceProps = {
  archivedCount: number;
  interactionActive: boolean;
  reducedMotion: boolean;
  surface: "archive-signal";
};

// The production desk is the matte CSS grid. Shader-backed explorations stay
// preserved in JournalDeskSurface.tsx, outside the initial production bundle.
export const JournalDeskSurface = memo(function JournalDeskSurface(
  _props: JournalDeskSurfaceProps,
) {
  return null;
});
