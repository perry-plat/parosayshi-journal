import Dexie, { type EntityTable } from "dexie";

export const FIELD_NOTES_DRAFTS_KEY = "field-notes:journal-drafts";
export const LOCAL_OWNER_ID = "local-preview";

export type FolderMaterial = "kraft" | "moss" | "clay" | "charcoal";
type FolderOrigin = "starter" | "user";

export const notebookPalette: Record<FolderMaterial, { color: string; edge: string; ink: string }> = {
  kraft: { color: "#df532f", edge: "#762817", ink: "#351710" },
  moss: { color: "#526f54", edge: "#263f2b", ink: "#122a18" },
  clay: { color: "#c8a33a", edge: "#705717", ink: "#3d310d" },
  charcoal: { color: "#2761b5", edge: "#173b78", ink: "#0d2347" },
};

export type FieldFolder = {
  id: string;
  ownerId: string;
  title: string;
  note: string;
  material: FolderMaterial;
  journalKey: string;
  prompt: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  origin?: FolderOrigin;
};

export type FieldFolderSummary = FieldFolder & {
  pageCount: number;
  pagePreviews: Array<{ number: number; text: string }>;
};

export type JournalSnapshot = {
  current: string;
  currentId: string;
  pages: Array<{
    id: string;
    slot: number;
    text: string;
    deskX?: number;
    deskY?: number;
    deskOrder?: number;
  }>;
};

type StoredJournal = {
  id: string;
  folderId: string;
  ownerId: string;
  snapshot: JournalSnapshot;
  revision: number;
  updatedAt: number;
};

type PendingChange = {
  id: string;
  ownerId: string;
  entity: "folder" | "journal";
  entityId: string;
  operation: "upsert" | "archive";
  payload: unknown;
  createdAt: number;
};

type FieldNotesMeta = {
  key: string;
  value: string;
};

class FieldNotesDatabase extends Dexie {
  folders!: EntityTable<FieldFolder, "id">;
  journals!: EntityTable<StoredJournal, "id">;
  outbox!: EntityTable<PendingChange, "id">;
  meta!: EntityTable<FieldNotesMeta, "key">;

  constructor() {
    super("field-notes-product");
    this.version(1).stores({
      folders: "id, ownerId, sortOrder, updatedAt, archivedAt",
      journals: "id, folderId, ownerId, updatedAt",
      outbox: "id, ownerId, entity, entityId, createdAt",
      meta: "key",
    });
  }
}

export const fieldNotesDb = new FieldNotesDatabase();

const starterPrompts = [
  "What did you notice today that you would usually walk past?",
  "Describe a small moment from this week that you want to keep.",
  "Write about something unfinished without trying to finish it.",
] as const;

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeSnapshot(value: unknown): JournalSnapshot | null {
  if (typeof value === "string") {
    return { current: value, currentId: makeId("page"), pages: [] };
  }
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<JournalSnapshot>;
  if (typeof candidate.current !== "string") return null;
  return {
    current: candidate.current,
    currentId: typeof candidate.currentId === "string" ? candidate.currentId : makeId("page"),
    pages: Array.isArray(candidate.pages) ? candidate.pages : [],
  };
}

function readLegacyDrafts() {
  try {
    const raw = window.localStorage.getItem(FIELD_NOTES_DRAFTS_KEY);
    if (!raw) return [] as Array<[string, JournalSnapshot]>;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed).flatMap(([key, value]) => {
      const snapshot = normalizeSnapshot(value);
      return snapshot ? [[key, snapshot] as [string, JournalSnapshot]] : [];
    });
  } catch {
    return [] as Array<[string, JournalSnapshot]>;
  }
}

function mergeLegacyDrafts(legacy: Array<[string, JournalSnapshot]>): [string, JournalSnapshot] | null {
  const first = legacy[0];
  if (!first) return null;

  const [journalKey, firstSnapshot] = first;
  const carriedPages = [
    ...firstSnapshot.pages,
    ...legacy.slice(1).flatMap(([, snapshot]) => [
      ...snapshot.pages,
      {
        id: snapshot.currentId,
        slot: 0,
        text: snapshot.current,
      },
    ]),
  ].map((page, index) => ({ ...page, slot: index }));

  return [journalKey, {
    current: firstSnapshot.current,
    currentId: firstSnapshot.currentId,
    pages: carriedPages,
  }];
}

function mergeSnapshots(snapshots: JournalSnapshot[]) {
  const first = snapshots[0];
  if (!first) return { current: "", currentId: makeId("page"), pages: [] } satisfies JournalSnapshot;

  const carriedPages = [
    ...first.pages,
    ...snapshots.slice(1).flatMap((snapshot) => [
      ...snapshot.pages,
      { id: snapshot.currentId, slot: 0, text: snapshot.current },
    ]),
  ].map((page, index) => ({ ...page, slot: index }));

  return { current: first.current, currentId: first.currentId, pages: carriedPages } satisfies JournalSnapshot;
}

async function migrateSingleNotebookDefault(ownerId: string) {
  const migrationKey = `single-notebook-default-v2:${ownerId}`;
  if (await fieldNotesDb.meta.get(migrationKey)) return;

  const folders = await fieldNotesDb.folders
    .where("ownerId")
    .equals(ownerId)
    .filter((folder) => folder.archivedAt === undefined)
    .sortBy("sortOrder");
  if (folders.length === 0) return;

  // A folder created by the Add notebook action is intentional. Older records
  // did not carry provenance, so multiple origin-less folders are the legacy
  // auto-import bug this migration repairs.
  if (folders.some((folder) => folder.origin === "user")) {
    await fieldNotesDb.meta.put({ key: migrationKey, value: new Date().toISOString() });
    return;
  }

  const [primary, ...duplicates] = folders;
  const journals = (await Promise.all(folders.map((folder) => fieldNotesDb.journals.get(folder.id))))
    .filter((journal): journal is StoredJournal => Boolean(journal));
  const now = Date.now();
  const snapshot = mergeSnapshots(journals.map((journal) => journal.snapshot));

  await fieldNotesDb.transaction("rw", fieldNotesDb.folders, fieldNotesDb.journals, fieldNotesDb.outbox, fieldNotesDb.meta, async () => {
    await fieldNotesDb.folders.put({
      ...primary,
      material: "kraft",
      origin: "starter",
      sortOrder: 0,
      updatedAt: now,
    });
    await fieldNotesDb.journals.put({
      id: primary.id,
      folderId: primary.id,
      ownerId,
      snapshot,
      revision: (journals.find((journal) => journal.folderId === primary.id)?.revision ?? 0) + 1,
      updatedAt: now,
    });
    for (const duplicate of duplicates) {
      await fieldNotesDb.folders.delete(duplicate.id);
      await fieldNotesDb.journals.delete(duplicate.id);
      await fieldNotesDb.outbox.where("entityId").equals(duplicate.id).delete();
    }
    await fieldNotesDb.meta.put({ key: migrationKey, value: new Date(now).toISOString() });
  });
}

function materialFor(index: number): FolderMaterial {
  return (["kraft", "charcoal", "moss", "clay"] as const)[index % 4];
}

async function queueChange(change: Omit<PendingChange, "id" | "createdAt">) {
  await fieldNotesDb.outbox.put({
    ...change,
    id: `${change.entity}:${change.entityId}`,
    createdAt: Date.now(),
  });
}

export async function ensureLocalLibrary(ownerId = LOCAL_OWNER_ID) {
  const existing = await fieldNotesDb.folders.where("ownerId").equals(ownerId).count();
  if (existing > 0) {
    await migrateSingleNotebookDefault(ownerId);
    return;
  }

  if (ownerId !== LOCAL_OWNER_ID) {
    const localFolders = await fieldNotesDb.folders.where("ownerId").equals(LOCAL_OWNER_ID).toArray();
    if (localFolders.length > 0) {
      await fieldNotesDb.transaction("rw", fieldNotesDb.folders, fieldNotesDb.journals, fieldNotesDb.outbox, async () => {
        for (const folder of localFolders) {
          await fieldNotesDb.folders.put({ ...folder, ownerId, updatedAt: Date.now() });
          const journal = await fieldNotesDb.journals.get(folder.id);
          if (journal) await fieldNotesDb.journals.put({ ...journal, ownerId, updatedAt: Date.now() });
        }
        const pending = await fieldNotesDb.outbox.where("ownerId").equals(LOCAL_OWNER_ID).toArray();
        for (const change of pending) await fieldNotesDb.outbox.put({ ...change, ownerId });
      });
      await migrateSingleNotebookDefault(ownerId);
      return;
    }
  }

  const now = Date.now();
  const legacyNotebook = mergeLegacyDrafts(readLegacyDrafts());
  const source = legacyNotebook
    ?? [starterPrompts[0], { current: "", currentId: makeId("page"), pages: [] }] as [string, JournalSnapshot];

  await fieldNotesDb.transaction("rw", fieldNotesDb.folders, fieldNotesDb.journals, fieldNotesDb.meta, async () => {
    // React StrictMode and multiple tabs can ask for the starter notebook at
    // the same time. Rechecking inside the write transaction makes creation
    // atomic across both calls and browser tabs.
    const concurrentlyCreated = await fieldNotesDb.folders.where("ownerId").equals(ownerId).count();
    if (concurrentlyCreated > 0) return;

    const [journalKey, snapshot] = source;
    const id = makeId("folder");
    const folder: FieldFolder = {
      id,
      ownerId,
      title: "Field notes",
      note: "Loose observations",
      material: materialFor(0),
      journalKey,
      prompt: journalKey,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      origin: "starter",
    };
    await fieldNotesDb.folders.add(folder);
    await fieldNotesDb.journals.add({
      id,
      folderId: id,
      ownerId,
      snapshot,
      revision: 1,
      updatedAt: now,
    });
    await fieldNotesDb.meta.put({ key: "legacy-migration", value: new Date(now).toISOString() });
    await fieldNotesDb.meta.put({ key: `single-notebook-default-v2:${ownerId}`, value: new Date(now).toISOString() });
  });
}

export async function listFolders(ownerId = LOCAL_OWNER_ID) {
  const folders = await fieldNotesDb.folders
    .where("ownerId")
    .equals(ownerId)
    .filter((folder) => folder.archivedAt === undefined)
    .sortBy("sortOrder");

  return Promise.all(folders.map(async (folder): Promise<FieldFolderSummary> => {
    const journal = await fieldNotesDb.journals.get(folder.id);
    const snapshot = journal?.snapshot;
    const notebookPages = snapshot
      ? [...snapshot.pages.map((page) => page.text), snapshot.current]
      : [""];
    return {
      ...folder,
      pageCount: notebookPages.length,
      pagePreviews: notebookPages
        .map((text, index) => ({ number: index + 1, text: text.trim() }))
        .slice(0, 3),
    };
  }));
}

export async function getJournalSnapshot(folderId: string) {
  return (await fieldNotesDb.journals.get(folderId))?.snapshot ?? null;
}

export async function createFolder(
  title = "Untitled field notes",
  ownerId = LOCAL_OWNER_ID,
  material?: FolderMaterial,
) {
  const folders = await listFolders(ownerId);
  const now = Date.now();
  const id = makeId("folder");
  const prompt = starterPrompts[folders.length % starterPrompts.length];
  const folder: FieldFolder = {
    id,
    ownerId,
    title,
    note: "New collection",
    material: material ?? materialFor(folders.length),
    journalKey: `field-notes:folder:${id}`,
    prompt,
    sortOrder: folders.length,
    createdAt: now,
    updatedAt: now,
    origin: "user",
  };
  await fieldNotesDb.folders.add(folder);
  await fieldNotesDb.journals.add({
    id,
    folderId: id,
    ownerId,
    snapshot: { current: "", currentId: makeId("page"), pages: [] },
    revision: 1,
    updatedAt: now,
  });
  await queueChange({ ownerId, entity: "folder", entityId: id, operation: "upsert", payload: folder });
  return folder;
}

export async function rolloverNotebook(current: FieldFolder) {
  const now = Date.now();
  const id = makeId("folder");
  const nextFolder: FieldFolder = {
    id,
    ownerId: current.ownerId,
    title: "Field notes",
    note: "New collection",
    material: current.material,
    journalKey: `field-notes:folder:${id}`,
    prompt: starterPrompts[Math.abs(current.createdAt) % starterPrompts.length],
    sortOrder: current.sortOrder,
    createdAt: now,
    updatedAt: now,
    origin: current.origin ?? "user",
  };
  const archivedFolder = { ...current, archivedAt: now, updatedAt: now };
  await fieldNotesDb.transaction("rw", fieldNotesDb.folders, fieldNotesDb.journals, fieldNotesDb.outbox, async () => {
    await fieldNotesDb.folders.put(archivedFolder);
    await fieldNotesDb.folders.add(nextFolder);
    await fieldNotesDb.journals.add({
      id,
      folderId: id,
      ownerId: current.ownerId,
      snapshot: { current: "", currentId: makeId("page"), pages: [] },
      revision: 1,
      updatedAt: now,
    });
    await queueChange({ ownerId: current.ownerId, entity: "folder", entityId: current.id, operation: "archive", payload: archivedFolder });
    await queueChange({ ownerId: current.ownerId, entity: "folder", entityId: id, operation: "upsert", payload: nextFolder });
  });
  return nextFolder;
}

export async function renameFolder(id: string, title: string) {
  const folder = await fieldNotesDb.folders.get(id);
  if (!folder) return;
  const next = { ...folder, title: title.trim() || folder.title, updatedAt: Date.now() };
  await fieldNotesDb.folders.put(next);
  await queueChange({ ownerId: next.ownerId, entity: "folder", entityId: id, operation: "upsert", payload: next });
}

export async function archiveFolder(id: string) {
  const folder = await fieldNotesDb.folders.get(id);
  if (!folder) return;
  const next = { ...folder, archivedAt: Date.now(), updatedAt: Date.now() };
  await fieldNotesDb.folders.put(next);
  await queueChange({ ownerId: next.ownerId, entity: "folder", entityId: id, operation: "archive", payload: next });
}

export async function deleteFolder(id: string) {
  await fieldNotesDb.transaction("rw", fieldNotesDb.folders, fieldNotesDb.journals, fieldNotesDb.outbox, async () => {
    await fieldNotesDb.folders.delete(id);
    await fieldNotesDb.journals.delete(id);
    await fieldNotesDb.outbox.where("entityId").equals(id).delete();
  });
}

export async function saveJournalSnapshot(folder: FieldFolder, snapshot: JournalSnapshot) {
  const existing = await fieldNotesDb.journals.get(folder.id);
  const next: StoredJournal = {
    id: folder.id,
    folderId: folder.id,
    ownerId: folder.ownerId,
    snapshot,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: Date.now(),
  };
  await fieldNotesDb.journals.put(next);
  await queueChange({
    ownerId: folder.ownerId,
    entity: "journal",
    entityId: folder.id,
    operation: "upsert",
    payload: next,
  });
}
