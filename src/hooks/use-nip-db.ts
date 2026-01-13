"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Event } from "nostr-tools/core";
import { useNostrRelay } from "./use-nostr-relay";
import { useNostrStore } from "@/lib/nostr-store";
import {
  getDocumentStore,
  createRevisionId,
  createDocumentTags,
  parseRevisionId,
  type Document,
} from "@/lib/nip-db";

// Default kind for our documents (notes)
const DOC_KIND = 40001;

// Stable empty array for server snapshot (avoids infinite loop in useSyncExternalStore)
const EMPTY_DOCS: Document[] = [];

export function useNipDb() {
  const { connect, disconnect, subscribe, publish, connectionState } =
    useNostrRelay();
  const { publicKey } = useNostrStore();
  const store = getDocumentStore();
  const subscriptionRef = useRef<(() => void) | null>(null);

  // Subscribe to store updates
  const documents = useSyncExternalStore(
    (callback) => store.subscribe(callback),
    () => store.getAllDocuments(),
    () => EMPTY_DOCS
  );

  // Subscribe to documents for the current public key
  const subscribeToDocuments = useCallback(() => {
    if (!publicKey) {
      console.error("No public key available");
      return;
    }

    // Clear previous subscription
    if (subscriptionRef.current) {
      subscriptionRef.current();
    }

    // Clear local store when re-subscribing (will be repopulated from relay)
    store.clear();

    // Subscribe to all syncable events from our pubkey
    subscriptionRef.current = subscribe(
      "nip-db-sync",
      [{ kinds: [DOC_KIND], authors: [publicKey] }],
      (event: Event) => {
        store.addRevision(event);
      },
      () => {
        console.log("Initial sync complete");
      }
    );
  }, [publicKey, subscribe, store]);

  // Connect and subscribe to documents
  const sync = useCallback(() => {
    if (!publicKey) {
      console.error("No public key available");
      return;
    }

    connect();

    // Wait for connection
    const checkConnection = setInterval(() => {
      if (connectionState === "connected") {
        clearInterval(checkConnection);
        subscribeToDocuments();
      }
    }, 100);

    // Timeout after 5 seconds
    setTimeout(() => clearInterval(checkConnection), 5000);
  }, [publicKey, connect, connectionState, subscribeToDocuments]);

  // Refresh documents from relay
  const refresh = useCallback(() => {
    if (connectionState !== "connected") {
      console.error("Not connected to relay");
      return;
    }
    subscribeToDocuments();
  }, [connectionState, subscribeToDocuments]);

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
      if (subscriptionRef.current) {
        subscriptionRef.current();
      }
      disconnect();
    };
  }, [disconnect]);

  return {
    // Connection
    sync,
    disconnect,
    refresh,
    connectionState,

    // Documents
    documents,
    createDocument,
    updateDocument,
    deleteDocument,
    getDocument,
    getRevisions,
  };
}
