"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Event } from "nostr-tools/core";
import { useNostrRelay } from "./use-nostr-relay";
import { useNostrStore } from "@/lib/nostr-store";
import {
  getDocumentStore,
  createRevisionId,
  createDocumentTags,
  createPurgeTags,
  parseRevisionId,
  isPurgeEvent,
  getPurgeTarget,
  PURGE_KIND,
  type Document,
} from "@/lib/nip-db";

// Default kind for our documents (notes)
const DOC_KIND = 40001;

// Stable empty array for server snapshot (avoids infinite loop in useSyncExternalStore)
const EMPTY_DOCS: Document[] = [];

export function useNipDb() {
  const { connect, disconnect, publish, fetchChanges, connectionState } =
    useNostrRelay();
  const { publicKey } = useNostrStore();
  const store = getDocumentStore();
  const lastSeqRef = useRef<number>(0);

  // Subscribe to store updates
  const documents = useSyncExternalStore(
    (callback) => store.subscribe(callback),
    () => store.getAllDocuments(),
    () => EMPTY_DOCS
  );

  // Fetch all documents using changes feed (initial sync)
  const fetchAllDocuments = useCallback(async () => {
    if (!publicKey) {
      console.error("No public key available");
      return;
    }

    // Clear local store for full sync
    store.clear();
    lastSeqRef.current = 0;

    try {
      // Fetch all changes from the beginning (including purge events)
      const result = await fetchChanges({
        since: 0,
        kinds: [DOC_KIND, PURGE_KIND],
        authors: [publicKey],
      });

      console.log(`Fetched ${result.changes.length} changes, lastSeq: ${result.lastSeq}`);

      // Add all events to the store
      for (const change of result.changes) {
        // Handle purge events
        if (isPurgeEvent(change.event)) {
          const target = getPurgeTarget(change.event);
          if (target) {
            store.purgeDocument(target.docId);
            console.log(`Purged document: ${target.docId}`);
          }
        } else {
          store.addRevision(change.event);
        }
      }

      // Save the last sequence for incremental sync
      lastSeqRef.current = result.lastSeq;
    } catch (e) {
      console.error("Failed to fetch documents:", e);
    }
  }, [publicKey, fetchChanges, store]);

  // Fetch only new changes since last sync (incremental sync)
  const fetchNewChanges = useCallback(async () => {
    if (!publicKey) {
      console.error("No public key available");
      return;
    }

    try {
      // Fetch new changes (including purge events)
      const result = await fetchChanges({
        since: lastSeqRef.current,
        kinds: [DOC_KIND, PURGE_KIND],
        authors: [publicKey],
      });

      if (result.changes.length > 0) {
        console.log(`Fetched ${result.changes.length} new changes, lastSeq: ${result.lastSeq}`);

        for (const change of result.changes) {
          // Handle purge events
          if (isPurgeEvent(change.event)) {
            const target = getPurgeTarget(change.event);
            if (target) {
              store.purgeDocument(target.docId);
              console.log(`Purged document: ${target.docId}`);
            }
          } else {
            store.addRevision(change.event);
          }
        }

        lastSeqRef.current = result.lastSeq;
      } else {
        console.log("No new changes");
      }
    } catch (e) {
      console.error("Failed to fetch changes:", e);
    }
  }, [publicKey, fetchChanges, store]);

  // Track if we should fetch after connecting
  const shouldFetchOnConnect = useRef(false);

  // Connect and fetch documents
  const sync = useCallback(() => {
    if (!publicKey) {
      console.error("No public key available");
      return;
    }

    shouldFetchOnConnect.current = true;
    connect();
  }, [publicKey, connect]);

  // Fetch documents when connection state changes to connected
  useEffect(() => {
    if (connectionState === "connected" && shouldFetchOnConnect.current) {
      shouldFetchOnConnect.current = false;
      fetchAllDocuments();
    }
  }, [connectionState, fetchAllDocuments]);

  // Refresh documents from relay (incremental sync using changes feed)
  const refresh = useCallback(() => {
    if (connectionState !== "connected") {
      console.error("Not connected to relay");
      return;
    }
    fetchNewChanges();
  }, [connectionState, fetchNewChanges]);

  // Full refresh (re-fetch everything)
  const fullRefresh = useCallback(() => {
    if (connectionState !== "connected") {
      console.error("Not connected to relay");
      return;
    }
    fetchAllDocuments();
  }, [connectionState, fetchAllDocuments]);

  // Create a new document
  const createDocument = useCallback(
    async (docId: string, content: string): Promise<Document | null> => {
      if (!publicKey) {
        throw new Error("No public key available");
      }

      const revisionId = createRevisionId(1, null, content);
      const tags = createDocumentTags(docId, revisionId, []);

      try {
        const event = await publish({
          kind: DOC_KIND,
          content,
          tags,
        });

        const result = store.addRevision(event);
        if (!result.accepted) {
          throw new Error(result.reason || "Revision rejected");
        }
        return store.getDocument(docId);
      } catch (e) {
        console.error("Failed to create document:", e);
        throw e;
      }
    },
    [publicKey, publish, store]
  );

  // Update an existing document
  const updateDocument = useCallback(
    async (docId: string, content: string): Promise<Document | null> => {
      if (!publicKey) {
        throw new Error("No public key available");
      }

      const currentDoc = store.getDocument(docId);
      if (!currentDoc) {
        throw new Error("Document not found");
      }

      const currentRevision = parseRevisionId(currentDoc.revisionId);
      const newGeneration = currentRevision.generation + 1;
      const revisionId = createRevisionId(
        newGeneration,
        currentDoc.revisionId,
        content
      );
      const tags = createDocumentTags(docId, revisionId, [
        currentDoc.revisionId,
      ]);

      try {
        const event = await publish({
          kind: DOC_KIND,
          content,
          tags,
        });

        const result = store.addRevision(event);
        if (!result.accepted) {
          throw new Error(result.reason || "Revision rejected");
        }
        return store.getDocument(docId);
      } catch (e) {
        console.error("Failed to update document:", e);
        throw e;
      }
    },
    [publicKey, publish, store]
  );

  // Delete a document (tombstone)
  const deleteDocument = useCallback(
    async (docId: string): Promise<void> => {
      if (!publicKey) {
        throw new Error("No public key available");
      }

      const currentDoc = store.getDocument(docId);
      if (!currentDoc) {
        throw new Error("Document not found");
      }

      const currentRevision = parseRevisionId(currentDoc.revisionId);
      const newGeneration = currentRevision.generation + 1;
      const revisionId = createRevisionId(
        newGeneration,
        currentDoc.revisionId,
        ""
      );
      const tags = createDocumentTags(
        docId,
        revisionId,
        [currentDoc.revisionId],
        true
      );

      try {
        const event = await publish({
          kind: DOC_KIND,
          content: "",
          tags,
        });

        const result = store.addRevision(event);
        if (!result.accepted) {
          throw new Error(result.reason || "Revision rejected");
        }
      } catch (e) {
        console.error("Failed to delete document:", e);
        throw e;
      }
    },
    [publicKey, publish, store]
  );

  // Purge a document (permanently delete all revisions)
  const purgeDocument = useCallback(
    async (docId: string): Promise<void> => {
      if (!publicKey) {
        throw new Error("No public key available");
      }

      const tags = createPurgeTags(docId, DOC_KIND);

      try {
        await publish({
          kind: PURGE_KIND,
          content: "",
          tags,
        });

        // Remove from local store immediately
        store.purgeDocument(docId);
      } catch (e) {
        console.error("Failed to purge document:", e);
        throw e;
      }
    },
    [publicKey, publish, store]
  );

  // Get document by ID
  const getDocument = useCallback(
    (docId: string): Document | null => {
      return store.getDocument(docId);
    },
    [store]
  );

  // Get revisions for a document
  const getRevisions = useCallback(
    (docId: string) => {
      return store.getRevisions(docId);
    },
    [store]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // Raw changes feed query (for debugging/visualization)
  const queryChanges = useCallback(
    async (since: number = 0) => {
      if (connectionState !== "connected") {
        throw new Error("Not connected to relay");
      }
      if (!publicKey) {
        throw new Error("No public key available");
      }
      return fetchChanges({ since, kinds: [DOC_KIND, PURGE_KIND], authors: [publicKey] });
    },
    [connectionState, fetchChanges, publicKey]
  );

  return {
    // Connection
    sync,
    disconnect,
    refresh,
    fullRefresh,
    connectionState,
    lastSeq: lastSeqRef.current,

    // Documents
    documents,
    createDocument,
    updateDocument,
    deleteDocument,
    purgeDocument,
    getDocument,
    getRevisions,

    // Changes feed
    queryChanges,
  };
}
