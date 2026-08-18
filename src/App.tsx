import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import {
  CloudSlashIcon,
  PlusIcon,
  GoogleLogoIcon,
  SignOutIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { JournalDappledLight } from "./components/JournalDappledLight";
import { countMeaningfulJournalPages, downloadJournalSnapshot, JournalPrompt, NotebookCoverArtwork } from "./components/JournalPrompt";
import { useReducedMotion } from "./hooks/useReducedMotion";
import {
  ensureLocalLibrary,
  getJournalSnapshot,
  type FieldFolder,
  type FieldFolderSummary,
  type JournalSnapshot,
  listFolders,
  LOCAL_OWNER_ID,
  notebookPalette,
  renameFolder,
  rolloverNotebook,
  saveJournalSnapshot,
} from "./lib/fieldNotesDb";
import { signInWithGoogle, supabase, supabaseConfigured } from "./lib/supabase";

type ProductMode = "threshold" | "naming" | "editor";

// Authentication is intentionally dormant while this first local-only edition
// is being shaped. Keeping this flag makes the Google/Supabase threshold easy
// to restore later without putting it in front of the notebook today.
const LOCAL_ONLY_EDITION = true;

// The product currently opens one primary notebook directly. The collection
// implementation stays intact below so multiple notebooks can be restored by
// routing back to FolderDesk instead of rebuilding this interaction later.
type FolderDeskProps = {
  accountLabel: string;
  folders: FieldFolderSummary[];
  onCreate: (title: string) => void;
  onOpen: (folder: FieldFolder) => void;
  onSignOut: () => void;
};

function FolderDesk({ accountLabel, folders, onCreate, onOpen, onSignOut }: FolderDeskProps) {
  const [composing, setComposing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  const submitFolder = () => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    onCreate(nextTitle);
    setTitle("");
    setComposing(false);
  };

  const openNotebook = (folder: FieldFolderSummary) => {
    if (openingId) return;
    const viewTransitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    if (!viewTransitionDocument.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onOpen(folder);
      return;
    }

    flushSync(() => setOpeningId(folder.id));
    viewTransitionDocument.startViewTransition(() => {
      flushSync(() => onOpen(folder));
    });
  };

  return (
    <main className="folder-desk" data-opening={Boolean(openingId)}>
      <header className="folder-desk__header">
        <div className="folder-desk__account">
          <span>{accountLabel}</span>
          <button aria-label="Sign out" onClick={onSignOut} title="Sign out" type="button"><SignOutIcon size={17} /></button>
        </div>
      </header>
      <section className="folder-desk__collection" aria-label="Your notebooks">
        <div className="folder-desk__folders">
          {folders.map((folder, index) => (
            <article className="field-notebook" data-material={folder.material} data-opening={openingId === folder.id} key={folder.id} style={{ "--notebook-index": index, "--notebook-color": notebookPalette[folder.material].color, "--notebook-edge": notebookPalette[folder.material].edge } as CSSProperties}>
              <span className="field-notebook__inner" aria-hidden="true" />
              <span className="field-notebook__paper-peek" aria-hidden="true">
                {folder.pagePreviews.map((page) => (
                  <span key={page.number} style={{ viewTransitionName: openingId === folder.id && page.number < folder.pageCount ? `field-note-page-${page.number}` : "none" }}>
                    <small>{String(page.number).padStart(2, "0")}</small>
                    {page.text ? <i>{page.text}</i> : null}
                  </span>
                ))}
              </span>
              <button className="field-notebook__body" onClick={() => openNotebook(folder)} type="button"><strong>{folder.title}</strong></button>
            </article>
          ))}
          <div className="folder-desk__new" data-composing={composing}>
            {composing ? (
              <form onSubmit={(event) => { event.preventDefault(); submitFolder(); }}>
                <label htmlFor="new-folder-title">Notebook name</label>
                <input autoFocus id="new-folder-title" maxLength={42} onChange={(event) => setTitle(event.target.value)} placeholder="Morning pages" value={title} />
                <div>
                  <button type="submit">Make notebook</button>
                  <button onClick={() => setComposing(false)} type="button">Cancel</button>
                </div>
              </form>
            ) : <button onClick={() => setComposing(true)} type="button"><PlusIcon size={18} /> New notebook</button>}
          </div>
        </div>
      </section>
    </main>
  );
}

function ProductLight() {
  const reducedMotion = useReducedMotion();
  return <JournalDappledLight reducedMotion={reducedMotion} />;
}

function ProductThreshold({ onPreview }: { onPreview: () => void }) {
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  const handleGoogleSignIn = async () => {
    setError("");
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in could not begin.");
      setSigningIn(false);
    }
  };

  return (
    <main className="product-threshold">
      <ProductLight />
      <div className="product-threshold__registration" aria-hidden="true">
        FIELD NOTES<br />PRIVATE DESK / 01
      </div>
      <section className="product-threshold__sheet" aria-labelledby="field-notes-title">
        <div className="product-threshold__clip" aria-hidden="true" />
        <p className="product-kicker">A place for what you notice</p>
        <h1 id="field-notes-title">Field Notes</h1>
        <p className="product-threshold__introduction">
          Keep loose observations, unfinished thoughts, and the marks you make around them.
        </p>
        <button className="product-google-button" disabled={!supabaseConfigured || signingIn} onClick={handleGoogleSignIn} type="button">
          <GoogleLogoIcon aria-hidden="true" size={19} weight="bold" />
          {signingIn ? "Opening Google…" : "Continue with Google"}
        </button>
        {!supabaseConfigured ? (
          <div className="product-threshold__preview">
            <span>PRODUCT PREVIEW</span>
            <button onClick={onPreview} type="button">Enter the local desk</button>
            <p>Google sign-in turns on when the private Supabase keys are added.</p>
          </div>
        ) : null}
        {error ? <p className="product-threshold__error" role="alert">{error}</p> : null}
        <p className="product-threshold__privacy">Your writing stays private to your account.</p>
      </section>
      <p className="product-threshold__edition">WEB EDITION · LOCAL FIRST</p>
    </main>
  );
}

type NameNotebookProps = {
  initialTitle: string;
  material: FieldFolder["material"];
  onContinue: (title: string) => void | Promise<void>;
  onFreshNotebook: () => void;
  showFreshNotebook: boolean;
};

function NameNotebook({ initialTitle, material, onContinue, onFreshNotebook, showFreshNotebook }: NameNotebookProps) {
  const [title, setTitle] = useState(initialTitle === "Field notes" ? "" : initialTitle);
  const [slipDragging, setSlipDragging] = useState(false);
  const sceneRef = useRef<HTMLElement>(null);
  const slipRef = useRef<HTMLElement>(null);
  const slipOffsetRef = useRef({ x: 0, y: 0 });
  const slipDragRef = useRef<{
    pointerId: number;
    notebookRect: DOMRect;
    startRect: DOMRect;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const constrainedSlipOffset = (drag: NonNullable<typeof slipDragRef.current>, rawX: number, rawY: number) => {
    const visibleEdge = 56;
    let deltaX = Math.max(visibleEdge - drag.startRect.right, Math.min(window.innerWidth - visibleEdge - drag.startRect.left, rawX));
    let deltaY = Math.max(visibleEdge - drag.startRect.bottom, Math.min(window.innerHeight - visibleEdge - drag.startRect.top, rawY));
    const proposed = {
      bottom: drag.startRect.bottom + deltaY,
      left: drag.startRect.left + deltaX,
      right: drag.startRect.right + deltaX,
      top: drag.startRect.top + deltaY,
    };
    const cover = drag.notebookRect;
    const intersectsCover = proposed.right > cover.left && proposed.left < cover.right && proposed.bottom > cover.top && proposed.top < cover.bottom;
    const visibleOutsideCover = Math.max(
      cover.left - proposed.left,
      proposed.right - cover.right,
      cover.top - proposed.top,
      proposed.bottom - cover.bottom,
    );
    if (intersectsCover && visibleOutsideCover < visibleEdge) {
      const escapes = [
        { axis: "x" as const, adjustment: cover.left - visibleEdge - proposed.left },
        { axis: "x" as const, adjustment: cover.right + visibleEdge - proposed.right },
        { axis: "y" as const, adjustment: cover.top - visibleEdge - proposed.top },
        { axis: "y" as const, adjustment: cover.bottom + visibleEdge - proposed.bottom },
      ].sort((a, b) => Math.abs(a.adjustment) - Math.abs(b.adjustment));
      const escape = escapes[0];
      if (escape.axis === "x") deltaX += escape.adjustment;
      else deltaY += escape.adjustment;
    }
    return { x: drag.originX + deltaX, y: drag.originY + deltaY };
  };

  const moveSlip = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = slipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const offset = constrainedSlipOffset(drag, event.clientX - drag.startX, event.clientY - drag.startY);
    slipRef.current?.style.setProperty("--slip-drag-x", `${offset.x}px`);
    slipRef.current?.style.setProperty("--slip-drag-y", `${offset.y}px`);
  };

  const finishSlipDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = slipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    slipOffsetRef.current = constrainedSlipOffset(drag, event.clientX - drag.startX, event.clientY - drag.startY);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    slipDragRef.current = null;
    setSlipDragging(false);
  };

  const updateNotebookShadow = (event: ReactPointerEvent<HTMLElement>) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const horizontal = event.clientX / window.innerWidth - .5;
    const vertical = event.clientY / window.innerHeight - .5;
    const shadowX = horizontal * -34;
    const shadowY = 26 + vertical * -20;
    sceneRef.current?.style.setProperty("--notebook-shadow-x", `${shadowX.toFixed(1)}px`);
    sceneRef.current?.style.setProperty("--notebook-shadow-y", `${shadowY.toFixed(1)}px`);
    sceneRef.current?.style.setProperty("--notebook-contact-x", `${(shadowX * .22).toFixed(1)}px`);
    sceneRef.current?.style.setProperty("--notebook-contact-y", `${Math.max(5, shadowY * .2).toFixed(1)}px`);
  };

  const resetNotebookShadow = () => {
    sceneRef.current?.style.removeProperty("--notebook-shadow-x");
    sceneRef.current?.style.removeProperty("--notebook-shadow-y");
    sceneRef.current?.style.removeProperty("--notebook-contact-x");
    sceneRef.current?.style.removeProperty("--notebook-contact-y");
  };

  return (
    <main className="product-threshold product-notebook-name" data-desk-surface="archive-signal" onPointerLeave={resetNotebookShadow} onPointerMove={updateNotebookShadow} ref={sceneRef}>
      <ProductLight />
      <section className="product-notebook-name__onboarding" aria-labelledby="notebook-name-title">
        <form className="product-notebook-name__form" onSubmit={(event) => {
          event.preventDefault();
          const nextTitle = title.trim();
          if (nextTitle) void onContinue(nextTitle);
        }}>
          <div className="product-notebook-name__cover journal-prompt__export-paper journal-prompt__export-paper--cover">
              <aside
                className="product-notebook-name__instruction-slip"
                data-dragging={slipDragging}
                onPointerCancel={finishSlipDrag}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  slipDragRef.current = {
                    pointerId: event.pointerId,
                    notebookRect: event.currentTarget.parentElement?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect(),
                    startRect: event.currentTarget.getBoundingClientRect(),
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: slipOffsetRef.current.x,
                    originY: slipOffsetRef.current.y,
                  };
                  setSlipDragging(true);
                }}
                onPointerMove={moveSlip}
                onPointerUp={finishSlipDrag}
                ref={slipRef}
              >
                <div className="product-notebook-name__slip-brand">
                  <img alt="" src="/assets/brand/parosayshi-wordmark.png" />
                  <small>@PAROSAYSHI</small>
                </div>
                <h1 id="notebook-name-title">Give this notebook a name</h1>
              </aside>
            <NotebookCoverArtwork material={material}>
              <label className="product-visually-hidden" htmlFor="notebook-title">Notebook title</label>
              <input
                autoComplete="off"
                autoFocus
                id="notebook-title"
                maxLength={42}
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </NotebookCoverArtwork>
          </div>
          <div className="product-notebook-name__actions">
            {showFreshNotebook ? <button className="product-notebook-name__cta product-notebook-name__cta--fresh" onClick={onFreshNotebook} type="button">New notebook</button> : null}
            <button className="product-notebook-name__cta" disabled={!title.trim()} type="submit">{showFreshNotebook ? "Continue" : "Start writing"}</button>
          </div>
        </form>
      </section>
    </main>
  );
}

type FreshNotebookDialogProps = {
  busy: boolean;
  downloaded: boolean;
  onClose: () => void;
  onCreate: () => void;
  onDownload: () => void;
  pageCount: number | null;
};

function FreshNotebookDialog({ busy, downloaded, onClose, onCreate, onDownload, pageCount }: FreshNotebookDialogProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const hasPages = pageCount !== null && pageCount > 0;
  return (
    <section
      aria-labelledby="fresh-notebook-title"
      aria-modal="true"
      className="product-fresh-notebook"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      role="dialog"
    >
      <div className="product-fresh-notebook__sheet">
        <h2 id="fresh-notebook-title">New notebook?</h2>
        {pageCount === null ? (
          <p>Checking what is already on this desk…</p>
        ) : (
          <ul className="product-fresh-notebook__facts">
            <li><WarningCircleIcon aria-hidden="true" size={17} /><span>Replaces the notebook on this desk</span></li>
            <li><CloudSlashIcon aria-hidden="true" size={17} /><span>No cloud backup</span></li>
            <li><i aria-hidden="true" className="product-fresh-notebook__cover-swatch" /><span>Download the current notebook to keep it</span></li>
          </ul>
        )}
        {pageCount !== null ? (
          <div className="product-fresh-notebook__actions">
            {hasPages ? <button disabled={busy || downloaded} onClick={onDownload} type="button">{downloaded ? "Downloaded" : "Download current"}</button> : null}
            <button className="product-fresh-notebook__create" disabled={busy} onClick={onCreate} type="button">{busy ? "Preparing…" : "Create new notebook"}</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [previewing, setPreviewing] = useState(() => window.sessionStorage.getItem("field-notes:local-preview") === "true");
  const [mode, setMode] = useState<ProductMode>("threshold");
  const [activeFolder, setActiveFolder] = useState<FieldFolder | null>(null);
  const [freshDialogOpen, setFreshDialogOpen] = useState(false);
  const [freshPageCount, setFreshPageCount] = useState<number | null>(null);
  const [freshSnapshot, setFreshSnapshot] = useState<JournalSnapshot | null>(null);
  const [freshBusy, setFreshBusy] = useState(false);
  const [freshDownloaded, setFreshDownloaded] = useState(false);
  const [returnedFromEditor, setReturnedFromEditor] = useState(false);

  const hasAccess = LOCAL_ONLY_EDITION || previewing || Boolean(session);
  const ownerId = session?.user.id ?? LOCAL_OWNER_ID;
  const openPrimaryNotebook = useCallback(async () => {
    await ensureLocalLibrary(ownerId);
    const [primaryNotebook] = await listFolders(ownerId);
    if (!primaryNotebook) return;
    setActiveFolder(primaryNotebook);
    const isFreshNotebook = primaryNotebook.title === "Field notes"
      && primaryNotebook.pagePreviews.every((page) => !page.text);
    const isOnboardingPreview = import.meta.env.DEV
      && new URLSearchParams(window.location.search).has("onboarding");
    setMode(isFreshNotebook || isOnboardingPreview ? "naming" : "editor");
  }, [ownerId]);

  useEffect(() => {
    let mounted = true;
    if (!supabase) {
      setBooting(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setBooting(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hasAccess) {
      setMode("threshold");
      return;
    }
    void openPrimaryNotebook();
  }, [hasAccess, openPrimaryNotebook]);

  const enterPreview = () => {
    window.sessionStorage.setItem("field-notes:local-preview", "true");
    setPreviewing(true);
  };

  const signOut = async () => {
    window.sessionStorage.removeItem("field-notes:local-preview");
    setPreviewing(false);
    setActiveFolder(null);
    if (supabase && session) await supabase.auth.signOut();
    setMode("threshold");
  };

  const nameNotebook = async (title: string) => {
    if (!activeFolder) return;
    await renameFolder(activeFolder.id, title);
    const [updated] = await listFolders(ownerId);
    if (!updated) return;
    setActiveFolder(updated);
    setFreshDialogOpen(false);
    setFreshPageCount(null);
    setFreshSnapshot(null);
    setReturnedFromEditor(false);
    setMode("editor");
  };

  const handleJournalChange = useCallback((snapshot: JournalSnapshot) => {
    if (!activeFolder) return;
    void saveJournalSnapshot(activeFolder, snapshot);
  }, [activeFolder]);

  const closeFreshDialog = useCallback(() => {
    if (freshBusy) return;
    setFreshDialogOpen(false);
  }, [freshBusy]);

  const openFreshDialog = useCallback(async () => {
    if (!activeFolder) return;
    setFreshDialogOpen(true);
    setFreshPageCount(null);
    setFreshSnapshot(null);
    setFreshDownloaded(false);
    const snapshot = await getJournalSnapshot(activeFolder.id);
    if (!snapshot) {
      setFreshPageCount(0);
      return;
    }
    setFreshSnapshot(snapshot);
    setFreshPageCount(await countMeaningfulJournalPages(snapshot));
  }, [activeFolder]);

  const downloadCurrentNotebook = useCallback(async () => {
    if (!activeFolder || !freshSnapshot || freshBusy) return;
    setFreshBusy(true);
    try {
      const downloaded = await downloadJournalSnapshot({
        folderTitle: activeFolder.title,
        snapshot: freshSnapshot,
      });
      setFreshDownloaded(downloaded);
    } finally {
      setFreshBusy(false);
    }
  }, [activeFolder, freshBusy, freshSnapshot]);

  const createFreshNotebook = useCallback(async () => {
    if (!activeFolder || freshBusy) return;
    setFreshBusy(true);
    try {
      const nextFolder = await rolloverNotebook(activeFolder);
      setActiveFolder(nextFolder);
      setFreshDialogOpen(false);
      setFreshPageCount(null);
      setFreshSnapshot(null);
      setFreshDownloaded(false);
      setReturnedFromEditor(false);
      setMode("naming");
    } finally {
      setFreshBusy(false);
    }
  }, [activeFolder, freshBusy]);

  if (booting) return <main className="product-boot"><span>FIELD NOTES</span></main>;
  if (!hasAccess) return <ProductThreshold onPreview={enterPreview} />;
  if (mode === "threshold") return <main className="product-boot"><span>PREPARING YOUR NOTEBOOK</span></main>;
  if (mode === "naming" && activeFolder) {
    return (
      <>
        <NameNotebook initialTitle={activeFolder.title} key={activeFolder.id} material={activeFolder.material} onContinue={nameNotebook} onFreshNotebook={() => void openFreshDialog()} showFreshNotebook={returnedFromEditor} />
        {returnedFromEditor && freshDialogOpen ? (
          <FreshNotebookDialog
            busy={freshBusy}
            downloaded={freshDownloaded}
            onClose={closeFreshDialog}
            onCreate={() => void createFreshNotebook()}
            onDownload={() => void downloadCurrentNotebook()}
            pageCount={freshPageCount}
          />
        ) : null}
      </>
    );
  }

  if (mode === "editor" && activeFolder) {
    return (
      <JournalPrompt
        folderTitle={activeFolder.title}
        journalKey={activeFolder.journalKey}
        notebookMaterial={activeFolder.material}
        onHome={() => {
          setFreshDialogOpen(false);
          setFreshPageCount(null);
          setFreshSnapshot(null);
          setReturnedFromEditor(true);
          setMode("naming");
        }}
        onJournalChange={handleJournalChange}
        promptText={activeFolder.prompt}
      />
    );
  }

  return <ProductThreshold onPreview={enterPreview} />;
}
