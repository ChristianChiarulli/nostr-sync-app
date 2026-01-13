import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Event } from "nostr-tools/core";

// NIP-DB Document types
export interface Document {
  id: string; // d tag value
  content: string;
  revisionId: string; // i tag value
  prevRevisionIds: string[]; // v tag values
  createdAt: number;
  eventId: string; // Nostr event ID
  deleted: boolean;
}

export interface DocumentRevision {
  revisionId: string;
  content: string;
  prevRevisionIds: string[];
  createdAt: number;
  eventId: string;
  deleted: boolean;
}

// Parse revision ID into generation and hash
export function parseRevisionId(revId: string): {
  generation: number;
  hash: string;
} {
  const [genStr, hash] = revId.split("-");
  return {
    generation: parseInt(genStr, 10),
    hash: hash || "",
  };
}

// Compute revision hash per NIP-DB spec
export function computeRevisionHash(
  prevRev: string | null,
  content: string
): string {
  const contentHash = bytesToHex(sha256(new TextEncoder().encode(content)));
  if (!prevRev) {
    return contentHash.substring(0, 32);
  }
  const combined = prevRev + ":" + contentHash;
  const fullHash = bytesToHex(sha256(new TextEncoder().encode(combined)));
  return fullHash.substring(0, 32);
}

// Create a new revision ID
export function createRevisionId(
  generation: number,
  prevRev: string | null,
  content: string
): string {
  const hash = computeRevisionHash(prevRev, content);
  return `${generation}-${hash}`;
}

// Deterministic conflict resolution: higher generation wins, then lexicographic hash
export function selectWinningRevision(revisions: DocumentRevision[]): DocumentRevision {
  return revisions.sort((a, b) => {
    const parsedA = parseRevisionId(a.revisionId);
    const parsedB = parseRevisionId(b.revisionId);

    // Higher generation wins
    if (parsedB.generation !== parsedA.generation) {
      return parsedB.generation - parsedA.generation;
    }

    // Higher hash (lexicographic) wins
    return parsedB.hash.localeCompare(parsedA.hash);
  })[0];
}

// Check if two revisions are in conflict (same parent)
export function areInConflict(
  rev1: DocumentRevision,
  rev2: DocumentRevision
): boolean {
  // Both have no parent (both are first revisions)
  if (rev1.prevRevisionIds.length === 0 && rev2.prevRevisionIds.length === 0) {
    return rev1.revisionId !== rev2.revisionId;
  }

  // Check if they share a parent
  const rev1Parents = new Set(rev1.prevRevisionIds);
  for (const parent of rev2.prevRevisionIds) {
    if (rev1Parents.has(parent)) {
      return true;
    }
  }

  return false;
}

// Convert a Nostr event (kind 40000-49999) to a DocumentRevision
export function eventToRevision(event: Event): DocumentRevision | null {
  // Must be a syncable kind
  if (event.kind < 40000 || event.kind >= 50000) {
    return null;
  }

  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  const iTag = event.tags.find((t) => t[0] === "i")?.[1];
  const vTags = event.tags.filter((t) => t[0] === "v").map((t) => t[1]);
  const deleted = event.tags.some((t) => t[0] === "deleted");

  if (!dTag || !iTag) {
    return null;
  }

  return {
    revisionId: iTag,
    content: event.content,
    prevRevisionIds: vTags,
    createdAt: event.created_at,
    eventId: event.id,
    deleted,
  };
}

// Build document from revisions
export function buildDocument(
  docId: string,
  revisions: DocumentRevision[]
): Document | null {
  if (revisions.length === 0) {
    return null;
  }

  const winning = selectWinningRevision(revisions);

  return {
    id: docId,
    content: winning.content,
    revisionId: winning.revisionId,
    prevRevisionIds: winning.prevRevisionIds,
    createdAt: winning.createdAt,
    eventId: winning.eventId,
    deleted: winning.deleted,
  };
}

// Create tags for a new document revision
export function createDocumentTags(
  docId: string,
  revisionId: string,
  prevRevisionIds: string[],
  deleted: boolean = false
): string[][] {
  const tags: string[][] = [["d", docId], ["i", revisionId]];

  for (const prevRev of prevRevisionIds) {
    tags.push(["v", prevRev]);
  }

  if (deleted) {
    tags.push(["deleted", ""]);
  }

  return tags;
}

// Document store class for managing local documents
export class DocumentStore {
  private documents: Map<string, Document> = new Map();
  private revisions: Map<string, DocumentRevision[]> = new Map();
  private listeners: Set<() => void> = new Set();
  private cachedDocuments: Document[] = [];

  // Add a revision from a Nostr event
  // Stores all revisions for history, uses selectWinningRevision for current state
  // Returns: { accepted: true } or { accepted: false, reason: string }
  addRevision(event: Event): { accepted: boolean; reason?: string } {
    const revision = eventToRevision(event);
    if (!revision) return { accepted: false, reason: "Invalid event format" };

    const dTag = event.tags.find((t) => t[0] === "d")?.[1];
    if (!dTag) return { accepted: false, reason: "Missing document ID (d tag)" };

    // Get or create revisions array for this document
    if (!this.revisions.has(dTag)) {
      this.revisions.set(dTag, []);
    }

    const docRevisions = this.revisions.get(dTag)!;

    // Check if we already have this revision
    if (docRevisions.some((r) => r.eventId === event.id)) {
      return { accepted: true }; // Already have it, not an error
    }

    // Build set of revision IDs that are referenced as parents (v tags)
    const referencedRevisions = new Set<string>();
    for (const existing of docRevisions) {
      for (const parentId of existing.prevRevisionIds) {
        referencedRevisions.add(parentId);
      }
    }
    // Also add parents from the new revision
    for (const parentId of revision.prevRevisionIds) {
      referencedRevisions.add(parentId);
    }

    // Check if this is a conflicting revision (same generation)
    const newParsed = parseRevisionId(revision.revisionId);

    for (const existing of docRevisions) {
      const existingParsed = parseRevisionId(existing.revisionId);

      // Same generation - check for conflict
      if (existingParsed.generation === newParsed.generation) {
        // If existing revision is referenced as a parent, keep it and reject new
        if (referencedRevisions.has(existing.revisionId)) {
          return {
            accepted: false,
            reason: `Document "${dTag}" already has a revision at generation ${newParsed.generation} that is part of the revision chain`,
          };
        }

        // Higher hash wins
        if (existingParsed.hash > newParsed.hash) {
          return {
            accepted: false,
            reason: `Document "${dTag}" already has a winning revision at generation ${newParsed.generation}`,
          };
        }
      }
    }

    // Remove any revisions at same generation that this one dominates
    // (but keep revisions that are referenced as parents)
    const filtered = docRevisions.filter((existing) => {
      const existingParsed = parseRevisionId(existing.revisionId);
      if (existingParsed.generation === newParsed.generation) {
        // Keep if referenced as parent
        if (referencedRevisions.has(existing.revisionId)) {
          return true;
        }
        // Otherwise, only keep if it has higher hash
        return existingParsed.hash > newParsed.hash;
      }
      return true;
    });

    filtered.push(revision);
    this.revisions.set(dTag, filtered);

    // Rebuild document with winning revision
    const doc = buildDocument(dTag, filtered);
    if (doc) {
      this.documents.set(dTag, doc);
    }

    this.notifyListeners();
    return { accepted: true };
  }

  // Get a document by ID
  getDocument(docId: string): Document | null {
    return this.documents.get(docId) || null;
  }

  // Get all documents (returns cached snapshot for useSyncExternalStore)
  getAllDocuments(): Document[] {
    return this.cachedDocuments;
  }

  // Get all revisions for a document
  getRevisions(docId: string): DocumentRevision[] {
    return this.revisions.get(docId) || [];
  }

  // Subscribe to changes
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    // Update cached snapshot before notifying (for useSyncExternalStore)
    this.cachedDocuments = Array.from(this.documents.values()).filter((d) => !d.deleted);
    this.listeners.forEach((listener) => listener());
  }

  // Clear all data
  clear(): void {
    this.documents.clear();
    this.revisions.clear();
    this.notifyListeners();
  }
}

// Singleton document store
let documentStore: DocumentStore | null = null;

export function getDocumentStore(): DocumentStore {
  if (!documentStore) {
    documentStore = new DocumentStore();
  }
  return documentStore;
}
