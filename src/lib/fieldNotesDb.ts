import Dexie, { type EntityTable } from "dexie";

export const FIELD_NOTES_DRAFTS_KEY = "field-notes:journal-drafts";
export const LOCAL_OWNER_ID = "local-preview";

export type FolderMaterial = "kraft" | "moss" | "clay" | "charcoal";

export const notebookPalette: Record<FolderMaterial, { color: string; edge: string; ink: string }> = {
  kraft: { color: "#f05b2c", edge: "#92321f", ink: "#351710" },
  moss: { color: "#08bd58", edge: "#087238", ink: "#073d22" },
  clay: { color: "#f0d31b", edge: "#a47c00", ink: "#443700" },
  charcoal: { color: "#8065df", edge: "#4b3a9d", ink: "#241b59" },
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

function materialFor(index: number): FolderMaterial {
  return (["kraft", "moss", "clay", "charcoal"] as const)[index % 4];
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
  if (existing > 0) return;

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
      return;
    }
  }

  const now = Date.now();
  const legacy = readLegacyDrafts();
  const sources = legacy.length > 0
    ? legacy
    : [[starterPrompts[0], { current: "", currentId: makeId("page"), pages: [] }] as [string, JournalSnapshot]];

  await fieldNotesDb.transaction("rw", fieldNotesDb.folders, fieldNotesDb.journals, fieldNotesDb.meta, async () => {
    for (const [index, [journalKey, snapshot]] of sources.entries()) {
      const id = makeId("folder");
      const folder: FieldFolder = {
        id,
        ownerId,
        title: index === 0 ? "Field notes" : `Recovered notebook ${String(index + 1).padStart(2, "0")}`,
        note: index === 0 ? "Loose observations" : "Recovered from this browser",
        material: materialFor(index),
        journalKey,
        prompt: journalKey,
        sortOrder: index,
        createdAt: now + index,
        updatedAt: now + index,
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
    }
    await fieldNotesDb.meta.put({ key: "legacy-migration", value: new Date(now).toISOString() });
  });
}

export async function listFolders(ownerId = LOCAL_OWNER_ID) {
  return fieldNotesDb.folders
    .where("ownerId")
    .equals(ownerId)
    .filter((folder) => folder.archivedAt === undefined)
    .sortBy("sortOrder");
}

export async function createFolder(title = "Untitled field notes", ownerId = LOCAL_OWNER_ID) {
  const folders = await listFolders(ownerId);
  const now = Date.now();
  const id = makeId("folder");
  const prompt = starterPrompts[folders.length % starterPrompts.length];
  const folder: FieldFolder = {
    id,
    ownerId,
    title,
    note: "New collection",
    material: materialFor(folders.length),
    journalKey: `field-notes:folder:${id}`,
    prompt,
    sortOrder: folders.length,
    createdAt: now,
    updatedAt: now,
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
