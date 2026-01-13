import { create } from "zustand";
import { persist } from "zustand/middleware";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

interface NostrState {
  // Keys (stored as hex strings for persistence)
  secretKey: string | null;
  publicKey: string | null;

  // Relay configuration
  relayUrl: string;

  // Connection status
  isConnected: boolean;

  // Actions
  generateKeys: () => void;
  importSecretKey: (nsec: string) => void;
  setRelayUrl: (url: string) => void;
  setConnected: (connected: boolean) => void;
  clearKeys: () => void;

  // Helpers
  getSecretKeyBytes: () => Uint8Array | null;
}

export const useNostrStore = create<NostrState>()(
  persist(
    (set, get) => ({
      secretKey: null,
      publicKey: null,
      relayUrl: "ws://localhost:4000",
      isConnected: false,

      generateKeys: () => {
        const sk = generateSecretKey();
        const pk = getPublicKey(sk);
        set({
          secretKey: bytesToHex(sk),
          publicKey: pk,
        });
      },

      importSecretKey: (skHex: string) => {
        try {
          const sk = hexToBytes(skHex);
          const pk = getPublicKey(sk);
          set({
            secretKey: skHex,
            publicKey: pk,
          });
        } catch (e) {
          console.error("Invalid secret key:", e);
        }
      },

      setRelayUrl: (url: string) => {
        set({ relayUrl: url });
      },

      setConnected: (connected: boolean) => {
        set({ isConnected: connected });
      },

      clearKeys: () => {
        set({ secretKey: null, publicKey: null });
      },

      getSecretKeyBytes: () => {
        const { secretKey } = get();
        if (!secretKey) return null;
        return hexToBytes(secretKey);
      },
    }),
    {
      name: "nostr-keys",
      partialize: (state) => ({
        secretKey: state.secretKey,
        publicKey: state.publicKey,
        relayUrl: state.relayUrl,
      }),
    }
  )
);
