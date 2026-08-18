import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import {
  PlusIcon,
  GoogleLogoIcon,
  SignOutIcon,
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { JournalDappledLight } from "./components/JournalDappledLight";
import { JournalPrompt } from "./components/JournalPrompt";
import { useReducedMotion } from "./hooks/useReducedMotion";
import {
  archiveFolder,
  createFolder,
  ensureLocalLibrary,
  type FieldFolder,
  type FieldFolderSummary,
  type JournalSnapshot,
  listFolders,
  LOCAL_OWNER_ID,
  notebookPalette,
  renameFolder,
  saveJournalSnapshot,
} from "./lib/fieldNotesDb";
import { signInWithGoogle, supabase, supabaseConfigured } from "./lib/supabase";

type ProductMode = "threshold" | "naming" | "editor";

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
  accountLabel: string;
  initialTitle: string;
  onContinue: (title: string) => void | Promise<void>;
  onSignOut: () => void;
};

function NameNotebook({ accountLabel, initialTitle, onContinue, onSignOut }: NameNotebookProps) {
  const [title, setTitle] = useState(initialTitle === "Field notes" ? "" : initialTitle);

  return (
    <main className="product-threshold product-notebook-name">
      <ProductLight />
      <div className="product-threshold__registration" aria-hidden="true">
        FIELD NOTES<br />ONE NOTEBOOK / 01
      </div>
      <section className="product-threshold__sheet" aria-labelledby="notebook-name-title">
        <div className="product-threshold__clip" aria-hidden="true" />
        <p className="product-kicker">Your notebook</p>
        <h1 id="notebook-name-title">What should we call these notes?</h1>
        <p className="product-threshold__introduction">This name will live on the cover and in every copy you export.</p>
        <form className="product-notebook-name__form" onSubmit={(event) => {
          event.preventDefault();
          const nextTitle = title.trim();
          if (nextTitle) void onContinue(nextTitle);
        }}>
          <label htmlFor="notebook-title">Notes name</label>
          <input autoFocus id="notebook-title" maxLength={42} onChange={(event) => setTitle(event.target.value)} placeholder="Things I noticed" value={title} />
          <button disabled={!title.trim()} type="submit">Open the notebook</button>
        </form>
        <div className="product-notebook-name__account">
          <span>{accountLabel}</span>
          <button onClick={onSignOut} type="button"><SignOutIcon aria-hidden="true" size={14} /> Leave</button>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [previewing, setPreviewing] = useState(() => window.sessionStorage.getItem("field-notes:local-preview") === "true");
  const [mode, setMode] = useState<ProductMode>("threshold");
  const [activeFolder, setActiveFolder] = useState<FieldFolder | null>(null);

  const hasAccess = previewing || Boolean(session);
  const ownerId = session?.user.id ?? LOCAL_OWNER_ID;
  const accountLabel = useMemo(() => session?.user.email || "Local preview", [session]);

  const openPrimaryNotebook = useCallback(async () => {
    await ensureLocalLibrary(ownerId);
    const [primaryNotebook] = await listFolders(ownerId);
    if (!primaryNotebook) return;
    setActiveFolder(primaryNotebook);
    const isFreshNotebook = primaryNotebook.title === "Field notes"
      && primaryNotebook.pagePreviews.every((page) => !page.text);
    setMode(isFreshNotebook ? "naming" : "editor");
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

  const handleRename = async (folder: FieldFolder) => {
    const title = window.prompt("Rename this notebook", folder.title);
    if (title === null) return;
    await renameFolder(folder.id, title);
    const [updated] = await listFolders(ownerId);
    if (updated) setActiveFolder(updated);
  };

  const nameNotebook = async (title: string) => {
    if (!activeFolder) return;
    await renameFolder(activeFolder.id, title);
    const [updated] = await listFolders(ownerId);
    if (!updated) return;
    setActiveFolder(updated);
    setMode("editor");
  };

  const handleJournalChange = useCallback((snapshot: JournalSnapshot) => {
    if (!activeFolder) return;
    void saveJournalSnapshot(activeFolder, snapshot);
  }, [activeFolder]);

  if (booting) return <main className="product-boot"><span>FIELD NOTES</span></main>;
  if (!hasAccess || mode === "threshold") return <ProductThreshold onPreview={enterPreview} />;
  if (mode === "naming" && activeFolder) {
    return <NameNotebook accountLabel={accountLabel} initialTitle={activeFolder.title} onContinue={nameNotebook} onSignOut={signOut} />;
  }

  if (mode === "editor" && activeFolder) {
    return (
      <>
        <button className="product-back-to-folders" onClick={signOut} type="button">
          <SignOutIcon size={15} /> Leave desk
        </button>
        <JournalPrompt
          folderTitle={activeFolder.title}
          journalKey={activeFolder.journalKey}
          notebookMaterial={activeFolder.material}
          onClose={signOut}
          onJournalChange={handleJournalChange}
          onRenameNotebook={() => handleRename(activeFolder)}
          promptText={activeFolder.prompt}
        />
      </>
    );
  }

  return <ProductThreshold onPreview={enterPreview} />;
}
