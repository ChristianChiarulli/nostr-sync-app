"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Event } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import { finalizeEvent } from "nostr-tools/pure";
import { useNostrStore } from "@/lib/nostr-store";

// Changes feed types
export interface ChangeEntry {
  seq: number;
  event: Event;
}

export interface ChangesResult {
  changes: ChangeEntry[];
  lastSeq: number;
}

type RelayMessage =
  | ["EVENT", string, Event]
  | ["OK", string, boolean, string]
  | ["EOSE", string]
  | ["CLOSED", string, string]
  | ["NOTICE", string]
  | ["CHANGES", ChangesResult]
  | ["LASTSEQ", number]
  | ["CHANGES_EVENT", string, ChangeEntry]
  | ["CHANGES_EOSE", string, { lastSeq: number }];

interface Subscription {
  id: string;
  filters: Filter[];
  onEvent: (event: Event) => void;
  onEose?: () => void;
}

interface ChangesSubscription {
  id: string;
  onEvent: (change: ChangeEntry) => void;
  onEose?: (lastSeq: number) => void;
}

export function useNostrRelay() {
  const wsRef = useRef<WebSocket | null>(null);
  const subscriptionsRef = useRef<Map<string, Subscription>>(new Map());
  const changesSubscriptionsRef = useRef<Map<string, ChangesSubscription>>(new Map());
  const pendingPublishRef = useRef<
    Map<string, { resolve: (ok: boolean) => void; reject: (err: Error) => void }>
  >(new Map());
  const pendingChangesRef = useRef<{
    resolve: (result: ChangesResult) => void;
    reject: (err: Error) => void;
  } | null>(null);
  const pendingLastSeqRef = useRef<{
    resolve: (seq: number) => void;
    reject: (err: Error) => void;
  } | null>(null);

  const { relayUrl, setConnected, getSecretKeyBytes } = useNostrStore();
  const [connectionState, setConnectionState] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");

  // Connect to relay
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionState("connecting");

    const ws = new WebSocket(relayUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("connected");
      setConnected(true);
      console.log("Connected to relay:", relayUrl);

      // Resubscribe to existing subscriptions
      subscriptionsRef.current.forEach((sub) => {
        const msg = JSON.stringify(["REQ", sub.id, ...sub.filters]);
        ws.send(msg);
      });
    };

    ws.onclose = () => {
      setConnectionState("disconnected");
      setConnected(false);
      console.log("Disconnected from relay");
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as RelayMessage;
        handleMessage(data);
      } catch (e) {
        console.error("Failed to parse message:", e);
      }
    };
  }, [relayUrl, setConnected]);

  // Disconnect from relay
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback((data: RelayMessage) => {
    const [type] = data;

    switch (type) {
      case "EVENT": {
        const [, subId, event] = data;
        const sub = subscriptionsRef.current.get(subId);
        if (sub) {
          sub.onEvent(event);
        }
        break;
      }
      case "OK": {
        const [, eventId, success, message] = data;
        const pending = pendingPublishRef.current.get(eventId);
        if (pending) {
          if (success) {
            pending.resolve(true);
          } else {
            pending.reject(new Error(message));
          }
          pendingPublishRef.current.delete(eventId);
        }
        break;
      }
      case "EOSE": {
        const [, subId] = data;
        const sub = subscriptionsRef.current.get(subId);
        if (sub?.onEose) {
          sub.onEose();
        }
        break;
      }
      case "CLOSED": {
        const [, subId, message] = data;
        console.log(`Subscription ${subId} closed:`, message);
        subscriptionsRef.current.delete(subId);
        break;
      }
      case "NOTICE": {
        const [, message] = data;
        console.log("Relay notice:", message);
        break;
      }
      case "CHANGES": {
        const [, result] = data;
        if (pendingChangesRef.current) {
          pendingChangesRef.current.resolve(result);
          pendingChangesRef.current = null;
        }
        break;
      }
      case "LASTSEQ": {
        const [, seq] = data;
        if (pendingLastSeqRef.current) {
          pendingLastSeqRef.current.resolve(seq);
          pendingLastSeqRef.current = null;
        }
        break;
      }
      case "CHANGES_EVENT": {
        const [, subId, change] = data;
        const sub = changesSubscriptionsRef.current.get(subId);
        if (sub) {
          sub.onEvent(change);
        }
        break;
      }
      case "CHANGES_EOSE": {
        const [, subId, { lastSeq }] = data;
        const sub = changesSubscriptionsRef.current.get(subId);
        if (sub?.onEose) {
          sub.onEose(lastSeq);
        }
        break;
      }
    }
  }, []);

  // Subscribe to events
  const subscribe = useCallback(
    (
      subId: string,
      filters: Filter[],
      onEvent: (event: Event) => void,
      onEose?: () => void
    ) => {
      const sub: Subscription = { id: subId, filters, onEvent, onEose };
      subscriptionsRef.current.set(subId, sub);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const msg = JSON.stringify(["REQ", subId, ...filters]);
        wsRef.current.send(msg);
      }

      // Return unsubscribe function
      return () => {
        subscriptionsRef.current.delete(subId);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(["CLOSE", subId]));
        }
      };
    },
    []
  );

  // Publish an event
  const publish = useCallback(
    async (eventTemplate: {
      kind: number;
      content: string;
      tags: string[][];
      created_at?: number;
    }): Promise<Event> => {
      const sk = getSecretKeyBytes();
      if (!sk) {
        throw new Error("No secret key available");
      }

      const event = finalizeEvent(
        {
          ...eventTemplate,
          created_at: eventTemplate.created_at ?? Math.floor(Date.now() / 1000),
        },
        sk
      );

      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        throw new Error("Not connected to relay");
      }

      return new Promise((resolve, reject) => {
        pendingPublishRef.current.set(event.id, {
          resolve: () => resolve(event),
          reject,
        });

        wsRef.current!.send(JSON.stringify(["EVENT", event]));

        // Timeout after 10 seconds
        setTimeout(() => {
          if (pendingPublishRef.current.has(event.id)) {
            pendingPublishRef.current.delete(event.id);
            reject(new Error("Publish timeout"));
          }
        }, 10000);
      });
    },
    [getSecretKeyBytes]
  );

  // Fetch changes since a sequence number (CouchDB-like changes feed)
  const fetchChanges = useCallback(
    async (options: {
      since?: number;
      limit?: number;
      kinds?: number[];
      authors?: string[];
    } = {}): Promise<ChangesResult> => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        throw new Error("Not connected to relay");
      }

      return new Promise((resolve, reject) => {
        pendingChangesRef.current = { resolve, reject };
        wsRef.current!.send(JSON.stringify(["CHANGES", options]));

        // Timeout after 30 seconds
        setTimeout(() => {
          if (pendingChangesRef.current) {
            pendingChangesRef.current = null;
            reject(new Error("Changes request timeout"));
          }
        }, 30000);
      });
    },
    []
  );

  // Get the current last sequence number
  const getLastSeq = useCallback(async (): Promise<number> => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to relay");
    }

    return new Promise((resolve, reject) => {
      pendingLastSeqRef.current = { resolve, reject };
      wsRef.current!.send(JSON.stringify(["LASTSEQ"]));

      // Timeout after 10 seconds
      setTimeout(() => {
        if (pendingLastSeqRef.current) {
          pendingLastSeqRef.current = null;
          reject(new Error("LastSeq request timeout"));
        }
      }, 10000);
    });
  }, []);

  // Subscribe to continuous changes feed
  const subscribeChanges = useCallback(
    (
      subId: string,
      options: {
        since?: number;
        kinds?: number[];
        authors?: string[];
      },
      onEvent: (change: ChangeEntry) => void,
      onEose?: (lastSeq: number) => void
    ) => {
      const sub: ChangesSubscription = { id: subId, onEvent, onEose };
      changesSubscriptionsRef.current.set(subId, sub);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(["CHANGES_SUB", subId, options]));
      }

      // Return unsubscribe function
      return () => {
        changesSubscriptionsRef.current.delete(subId);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(["CHANGES_UNSUB", subId]));
        }
      };
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connect,
    disconnect,
    subscribe,
    publish,
    fetchChanges,
    getLastSeq,
    subscribeChanges,
    connectionState,
  };
}
