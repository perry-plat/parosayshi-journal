import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  GoogleLogoIcon,
  PencilSimpleIcon,
  PlusIcon,
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
  type JournalSnapshot,
  listFolders,
  LOCAL_OWNER_ID,
  notebookPalette,
  renameFolder,
  saveJournalSnapshot,
} from "./lib/fieldNotesDb";
import { signInWithGoogle, supabase, supabaseConfigured } from "./lib/supabase";

type ProductMode = "threshold" | "folders" | "editor";

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

type FolderDeskProps = {
  accountLabel: string;
  cloudLabel: string;
  folders: FieldFolder[];
  onArchive: (folder: FieldFolder) => void;
  onCreate: (title: string) => void;
  onOpen: (folder: FieldFolder) => void;
  onRename: (folder: FieldFolder) => void;
  onSignOut: () => void;
};

function FolderDesk({ accountLabel, cloudLabel, folders, onArchive, onCreate, onOpen, onRename, onSignOut }: FolderDeskProps) {
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");

  const submitFolder = () => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    onCreate(nextTitle);
    setTitle("");
    setComposing(false);
  };

  return (
    <main className="folder-desk">
      <ProductLight />
      <header className="folder-desk__header">
        <div>
          <p className="product-kicker">Private collection</p>
          <h1>Field Notes</h1>
        </div>
        <div className="folder-desk__account">
          <span>{accountLabel}</span>
          <button aria-label="Sign out" onClick={onSignOut} title="Sign out" type="button"><SignOutIcon size={17} /></button>
        </div>
      </header>

      <section className="folder-desk__collection" aria-label="Your notebooks">
        <div className="folder-desk__legend">
          <span>NOTEBOOKS / {String(folders.length).padStart(2, "0")}</span>
          <p>Choose a notebook and lay its papers out.</p>
        </div>
        <div className="folder-desk__folders">
          {folders.map((folder, index) => (
            <article className="field-notebook" data-material={folder.material} key={folder.id} style={{ "--notebook-index": index, "--notebook-color": notebookPalette[folder.material].color, "--notebook-edge": notebookPalette[folder.material].edge } as CSSProperties}>
              <div className="field-notebook__pages" aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span></div>
              <button className="field-notebook__body" onClick={() => onOpen(folder)} type="button">
                <strong>{folder.title}</strong>
              </button>
              <div className="field-notebook__actions">
                <button aria-label={`Rename ${folder.title}`} onClick={() => onRename(folder)} title="Rename notebook" type="button"><PencilSimpleIcon size={15} /></button>
                <button aria-label={`Archive ${folder.title}`} onClick={() => onArchive(folder)} title="Archive notebook" type="button"><ArchiveIcon size={15} /></button>
              </div>
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
            ) : (
              <button onClick={() => setComposing(true)} type="button"><PlusIcon size={18} /> New notebook</button>
            )}
          </div>
        </div>
      </section>

      <footer className="folder-desk__footer">
        <span>SAVED ON THIS DEVICE</span>
        <span>{cloudLabel}</span>
      </footer>
    </main>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [previewing, setPreviewing] = useState(() => window.sessionStorage.getItem("field-notes:local-preview") === "true");
  const [mode, setMode] = useState<ProductMode>("threshold");
  const [folders, setFolders] = useState<FieldFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState<FieldFolder | null>(null);

  const hasAccess = previewing || Boolean(session);
  const ownerId = session?.user.id ?? LOCAL_OWNER_ID;
  const accountLabel = useMemo(() => session?.user.email || "Local preview", [session]);

  const refreshFolders = useCallback(async () => {
    await ensureLocalLibrary(ownerId);
    setFolders(await listFolders(ownerId));
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
    refreshFolders().then(() => setMode((current) => current === "threshold" ? "folders" : current));
  }, [hasAccess, refreshFolders]);

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

  const handleCreate = async (title: string) => {
    const folder = await createFolder(title, ownerId);
    await refreshFolders();
    setActiveFolder(folder);
    setMode("editor");
  };

  const handleRename = async (folder: FieldFolder) => {
    const title = window.prompt("Rename this notebook", folder.title);
    if (title === null) return;
    await renameFolder(folder.id, title);
    await refreshFolders();
  };

  const handleArchive = async (folder: FieldFolder) => {
    if (!window.confirm(`Archive “${folder.title}”? Its papers stay recoverable on this device.`)) return;
    await archiveFolder(folder.id);
    await refreshFolders();
  };

  const handleJournalChange = useCallback((snapshot: JournalSnapshot) => {
    if (!activeFolder) return;
    void saveJournalSnapshot(activeFolder, snapshot);
  }, [activeFolder]);

  if (booting) return <main className="product-boot"><span>FIELD NOTES</span></main>;
  if (!hasAccess || mode === "threshold") return <ProductThreshold onPreview={enterPreview} />;

  if (mode === "editor" && activeFolder) {
    return (
      <>
        <button className="product-back-to-folders" onClick={() => { setActiveFolder(null); setMode("folders"); }} type="button">
          <ArrowLeftIcon size={16} /> Notebooks
        </button>
        <JournalPrompt
          folderTitle={activeFolder.title}
          journalKey={activeFolder.journalKey}
          notebookMaterial={activeFolder.material}
          onClose={() => { setActiveFolder(null); setMode("folders"); }}
          onJournalChange={handleJournalChange}
          promptText={activeFolder.prompt}
        />
      </>
    );
  }

  return (
    <FolderDesk
      accountLabel={accountLabel}
      cloudLabel={session ? "ACCOUNT CONNECTED · SYNC NEXT" : "CLOUD SETUP PENDING"}
      folders={folders}
      onArchive={handleArchive}
      onCreate={handleCreate}
      onOpen={(folder) => { setActiveFolder(folder); setMode("editor"); }}
      onRename={handleRename}
      onSignOut={signOut}
    />
  );
}
