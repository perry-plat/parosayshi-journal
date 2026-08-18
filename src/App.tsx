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
import { DeferredJournalDappledLight } from "./components/DeferredJournalDappledLight";
import { downloadJournalSnapshot, JournalPrompt, NotebookCoverArtwork } from "./components/JournalPrompt";
import { loadHighlightStrokes, removeHighlightStrokes } from "./components/journalInk";
import { useReducedMotion } from "./hooks/useReducedMotion";
import {
  ensureLocalLibrary,
  createFolder,
  deleteFolder,
  getJournalSnapshot,
  type FieldFolder,
  type FieldFolderSummary,
  type JournalSnapshot,
  listFolders,
  LOCAL_OWNER_ID,
  notebookPalette,
  renameFolder,
  saveJournalSnapshot,
} from "./lib/fieldNotesDb";
import { getSupabaseClient, signInWithGoogle, supabaseConfigured } from "./lib/supabase";

type ProductMode = "threshold" | "naming" | "editor";

// Authentication is intentionally dormant while this first local-only edition
// is being shaped. Keeping this flag makes the Google/Supabase threshold easy
// to restore later without putting it in front of the notebook today.
const LOCAL_ONLY_EDITION = true;
const MAX_LOCAL_NOTEBOOKS = 2;

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
  return <DeferredJournalDappledLight reducedMotion={reducedMotion} />;
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
  activeId: string;
  folders: FieldFolderSummary[];
  initialTitle: string;
  material: FieldFolder["material"];
  onContinue: (title: string) => void | Promise<void>;
  onFreshNotebook: () => void;
  onSelectNotebook: (folder: FieldFolderSummary) => void;
  showFreshNotebook: boolean;
};

function NameNotebook({ activeId, folders, initialTitle, material, onContinue, onFreshNotebook, onSelectNotebook, showFreshNotebook }: NameNotebookProps) {
  const [title, setTitle] = useState(initialTitle === "Field notes" ? "" : initialTitle);
  const [initialArrival, setInitialArrival] = useState(true);
  const [shuffleTargetId, setShuffleTargetId] = useState<string | null>(null);
  const [slipDragging, setSlipDragging] = useState(false);
  const sceneRef = useRef<HTMLElement>(null);
  const notebookShadowFrameRef = useRef(0);
  const notebookShadowPointerRef = useRef({ x: window.innerWidth * .5, y: window.innerHeight * .5 });
  const reducedMotionQueryRef = useRef<MediaQueryList | null>(null);
  const slipRef = useRef<HTMLElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => () => {
    window.cancelAnimationFrame(notebookShadowFrameRef.current);
  }, []);

  useEffect(() => {
    setTitle(initialTitle === "Field notes" ? "" : initialTitle);
  }, [activeId, initialTitle]);

  useEffect(() => {
    const timer = window.setTimeout(() => setInitialArrival(false), 620);
    return () => window.clearTimeout(timer);
  }, []);

  const updateNotebookShadow = (event: ReactPointerEvent<HTMLElement>) => {
    reducedMotionQueryRef.current ??= window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotionQueryRef.current.matches) return;
    notebookShadowPointerRef.current = { x: event.clientX, y: event.clientY };
    if (notebookShadowFrameRef.current) return;
    notebookShadowFrameRef.current = window.requestAnimationFrame(() => {
      notebookShadowFrameRef.current = 0;
      const horizontal = notebookShadowPointerRef.current.x / window.innerWidth - .5;
      const vertical = notebookShadowPointerRef.current.y / window.innerHeight - .5;
      const shadowX = horizontal * -34;
      const shadowY = 26 + vertical * -20;
      sceneRef.current?.style.setProperty("--notebook-shadow-x", `${shadowX.toFixed(1)}px`);
      sceneRef.current?.style.setProperty("--notebook-shadow-y", `${shadowY.toFixed(1)}px`);
      sceneRef.current?.style.setProperty("--notebook-contact-x", `${(shadowX * .22).toFixed(1)}px`);
      sceneRef.current?.style.setProperty("--notebook-contact-y", `${Math.max(5, shadowY * .2).toFixed(1)}px`);
    });
  };

  const resetNotebookShadow = () => {
    window.cancelAnimationFrame(notebookShadowFrameRef.current);
    notebookShadowFrameRef.current = 0;
    sceneRef.current?.style.removeProperty("--notebook-shadow-x");
    sceneRef.current?.style.removeProperty("--notebook-shadow-y");
    sceneRef.current?.style.removeProperty("--notebook-contact-x");
    sceneRef.current?.style.removeProperty("--notebook-contact-y");
  };

  return (
    <main className="product-threshold product-notebook-name" data-desk-surface="archive-signal" onPointerLeave={resetNotebookShadow} onPointerMove={updateNotebookShadow} ref={sceneRef}>
      <ProductLight />
      <section className="product-notebook-name__onboarding" aria-labelledby="notebook-name-title">
        <form className="product-notebook-name__form" data-shuffling={Boolean(shuffleTargetId)} onSubmit={(event) => {
          event.preventDefault();
          const nextTitle = title.trim();
          if (nextTitle) void onContinue(nextTitle);
        }}>
          <div className="product-notebook-name__stack" data-count={folders.length}>
            {folders.filter((folder) => folder.id !== activeId).map((folder) => (
              <button
                aria-label={`Open ${folder.title}`}
                className="product-notebook-name__stack-back journal-prompt__export-paper journal-prompt__export-paper--cover"
                data-shuffling={shuffleTargetId === folder.id}
                key={folder.id}
                onClick={() => {
                  if (shuffleTargetId) return;
                  setInitialArrival(false);
                  setShuffleTargetId(folder.id);
                  window.setTimeout(() => {
                    onSelectNotebook(folder);
                    setShuffleTargetId(null);
                  }, 390);
                }}
                type="button"
              >
                <NotebookCoverArtwork material={folder.material} title={folder.title} />
              </button>
            ))}
          </div>
          <div className="product-notebook-name__slip-anchor">
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
                  notebookRect: coverRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect(),
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
                <img alt="" src={`${import.meta.env.BASE_URL}assets/brand/parosayshi-wordmark.png`} />
                <small>@PAROSAYSHI</small>
              </div>
              <h1 id="notebook-name-title">Give this notebook a name</h1>
            </aside>
          </div>
          <div className="product-notebook-name__cover journal-prompt__export-paper journal-prompt__export-paper--cover" data-initial-arrival={initialArrival} data-shuffling={Boolean(shuffleTargetId)} ref={coverRef}>
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
            {showFreshNotebook ? <button className="product-notebook-name__cta product-notebook-name__cta--fresh" onClick={onFreshNotebook} type="button"><PlusIcon aria-hidden="true" size={15} /> Add notebook</button> : null}
            <button className="product-notebook-name__cta" disabled={!title.trim()} type="submit">{showFreshNotebook ? "Continue" : "Start writing"}</button>
          </div>
        </form>
      </section>
    </main>
  );
}

type FreshNotebookDialogProps = {
  busy: boolean;
  downloadedId: string | null;
  folders: FieldFolderSummary[];
  onClose: () => void;
  onCreate: (folderId: string) => void;
  onDownload: (folderId: string) => void;
};

function FreshNotebookDialog({ busy, downloadedId, folders, onClose, onCreate, onDownload }: FreshNotebookDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const selected = folders.find((folder) => folder.id === selectedId) ?? null;
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
        <h2 id="fresh-notebook-title">Make room for one more</h2>
        <p>This desk keeps two notebooks in this browser. Choose one to remove before making a new notebook.</p>
        <div className="product-fresh-notebook__choices" role="radiogroup" aria-label="Notebook to remove">
          {folders.map((folder) => (
            <button
              aria-checked={selectedId === folder.id}
              className="product-fresh-notebook__choice"
              data-material={folder.material}
              data-selected={selectedId === folder.id}
              key={folder.id}
              onClick={() => setSelectedId(folder.id)}
              role="radio"
              style={{ "--choice-color": notebookPalette[folder.material].color, "--choice-edge": notebookPalette[folder.material].edge } as CSSProperties}
              type="button"
            >
              <i aria-hidden="true" />
              <span><strong>{folder.title}</strong><small>{folder.pageCount} {folder.pageCount === 1 ? "page" : "pages"}</small></span>
            </button>
          ))}
        </div>
        <ul className="product-fresh-notebook__facts">
          <li><WarningCircleIcon aria-hidden="true" size={17} /><span>The selected notebook and its highlighter marks will be deleted from this browser.</span></li>
          <li><CloudSlashIcon aria-hidden="true" size={17} /><span>There is no cloud backup yet.</span></li>
        </ul>
        <div className="product-fresh-notebook__actions">
          {selected && selected.pageCount > 0 ? <button disabled={busy || downloadedId === selected.id} onClick={() => onDownload(selected.id)} type="button">{downloadedId === selected.id ? "Downloaded" : "Download selected"}</button> : null}
          <button className="product-fresh-notebook__create" disabled={busy || !selectedId} onClick={() => selectedId && onCreate(selectedId)} type="button">{busy ? "Preparing…" : "Delete & create new"}</button>
        </div>
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
  const [folders, setFolders] = useState<FieldFolderSummary[]>([]);
  const [freshDialogOpen, setFreshDialogOpen] = useState(false);
  const [freshBusy, setFreshBusy] = useState(false);
  const [freshDownloadedId, setFreshDownloadedId] = useState<string | null>(null);
  const [returnedFromEditor, setReturnedFromEditor] = useState(false);

  const hasAccess = LOCAL_ONLY_EDITION || previewing || Boolean(session);
  const ownerId = session?.user.id ?? LOCAL_OWNER_ID;
  const openPrimaryNotebook = useCallback(async () => {
    await ensureLocalLibrary(ownerId);
    const localFolders = await listFolders(ownerId);
    const [primaryNotebook] = localFolders;
    if (!primaryNotebook) return;
    setFolders(localFolders);
    setActiveFolder(primaryNotebook);
    const isFreshNotebook = primaryNotebook.title === "Field notes"
      && primaryNotebook.pagePreviews.every((page) => !page.text);
    const isOnboardingPreview = import.meta.env.DEV
      && new URLSearchParams(window.location.search).has("onboarding");
    setMode(isFreshNotebook || isOnboardingPreview ? "naming" : "editor");
  }, [ownerId]);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    if (LOCAL_ONLY_EDITION || !supabaseConfigured) {
      setBooting(false);
      return;
    }
    void getSupabaseClient().then(async (supabase) => {
      if (!mounted || !supabase) return;
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      setBooting(false);
      const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
      unsubscribe = () => subscription.subscription.unsubscribe();
    });
    return () => {
      mounted = false;
      unsubscribe?.();
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
    setFolders([]);
    if (session) {
      const supabase = await getSupabaseClient();
      await supabase?.auth.signOut();
    }
    setMode("threshold");
  };

  const nameNotebook = async (title: string) => {
    if (!activeFolder) return;
    await renameFolder(activeFolder.id, title);
    const updatedFolders = await listFolders(ownerId);
    const updated = updatedFolders.find((folder) => folder.id === activeFolder.id);
    if (!updated) return;
    setFolders(updatedFolders);
    setActiveFolder(updated);
    setFreshDialogOpen(false);
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

  const materialForNewNotebook = useCallback((currentFolders: FieldFolderSummary[]) => (
    currentFolders.some((folder) => folder.material === "kraft") ? "charcoal" : "kraft"
  ), []);

  const addNotebook = useCallback(async () => {
    if (!activeFolder) return;
    if (folders.length < MAX_LOCAL_NOTEBOOKS) {
      setFreshBusy(true);
      try {
        const nextFolder = await createFolder("Field notes", ownerId, materialForNewNotebook(folders));
        const updatedFolders = await listFolders(ownerId);
        setFolders(updatedFolders);
        setActiveFolder(nextFolder);
        setReturnedFromEditor(false);
        setMode("naming");
      } finally {
        setFreshBusy(false);
      }
      return;
    }
    setFreshDialogOpen(true);
    setFreshDownloadedId(null);
  }, [activeFolder, folders, materialForNewNotebook, ownerId]);

  const downloadNotebook = useCallback(async (folderId: string) => {
    const folder = folders.find((candidate) => candidate.id === folderId);
    if (!folder || freshBusy) return;
    setFreshBusy(true);
    try {
      const snapshot = await getJournalSnapshot(folder.id);
      if (!snapshot) return;
      const downloaded = await downloadJournalSnapshot({
        folderTitle: folder.title,
        snapshot,
      });
      if (downloaded) setFreshDownloadedId(folder.id);
    } finally {
      setFreshBusy(false);
    }
  }, [folders, freshBusy]);

  const replaceNotebook = useCallback(async (folderId: string) => {
    if (freshBusy) return;
    const folderToDelete = folders.find((folder) => folder.id === folderId);
    if (!folderToDelete) return;
    setFreshBusy(true);
    try {
      const snapshot = await getJournalSnapshot(folderId);
      const pageIds = new Set(snapshot ? [snapshot.currentId, ...snapshot.pages.map((page) => page.id)] : []);
      const strokes = pageIds.size > 0 ? await loadHighlightStrokes() : [];
      await deleteFolder(folderId);
      await removeHighlightStrokes(strokes.filter((stroke) => pageIds.has(stroke.pageId)).map((stroke) => stroke.id));
      const remaining = folders.filter((folder) => folder.id !== folderId);
      const nextFolder = await createFolder("Field notes", ownerId, materialForNewNotebook(remaining));
      const updatedFolders = await listFolders(ownerId);
      setFolders(updatedFolders);
      setActiveFolder(nextFolder);
      setFreshDialogOpen(false);
      setFreshDownloadedId(null);
      setReturnedFromEditor(false);
      setMode("naming");
    } finally {
      setFreshBusy(false);
    }
  }, [folders, freshBusy, materialForNewNotebook, ownerId]);

  const selectNotebook = useCallback((folder: FieldFolderSummary) => {
    setActiveFolder(folder);
    setReturnedFromEditor(true);
    setFreshDialogOpen(false);
  }, []);

  if (booting) return <main className="product-boot"><span>FIELD NOTES</span></main>;
  if (!hasAccess) return <ProductThreshold onPreview={enterPreview} />;
  if (mode === "threshold") return <main className="product-boot"><span>PREPARING YOUR NOTEBOOK</span></main>;
  if (mode === "naming" && activeFolder) {
    return (
      <>
        <NameNotebook activeId={activeFolder.id} folders={folders} initialTitle={activeFolder.title} material={activeFolder.material} onContinue={nameNotebook} onFreshNotebook={() => void addNotebook()} onSelectNotebook={selectNotebook} showFreshNotebook={returnedFromEditor} />
        {returnedFromEditor && freshDialogOpen ? (
          <FreshNotebookDialog
            busy={freshBusy}
            downloadedId={freshDownloadedId}
            folders={folders}
            onClose={closeFreshDialog}
            onCreate={(folderId) => void replaceNotebook(folderId)}
            onDownload={(folderId) => void downloadNotebook(folderId)}
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
