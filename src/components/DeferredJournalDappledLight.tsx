import { lazy, Suspense } from "react";

const JournalDappledLight = lazy(() => import("./JournalDappledLight").then((module) => ({
  default: module.JournalDappledLight,
})));

export function DeferredJournalDappledLight({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <Suspense fallback={null}>
      <JournalDappledLight reducedMotion={reducedMotion} />
    </Suspense>
  );
}
