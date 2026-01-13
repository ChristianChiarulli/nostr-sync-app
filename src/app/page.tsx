"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useNostrStore } from "@/lib/nostr-store";
import { useNipDb } from "@/hooks/use-nip-db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  KeyRound,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
  Edit3,
  GitBranch,
  CheckCircle,
  ChevronDown,
  History,
} from "lucide-react";

export default function Home() {
  const {
    secretKey,
    publicKey,
    relayUrl,
    generateKeys,
    setRelayUrl,
    importSecretKey,
  } = useNostrStore();

  const {
    sync,
    disconnect,
    connectionState,
    documents,
    createDocument,
    updateDocument,
    deleteDocument,
    getRevisions,
  } = useNipDb();

  // Form state
  const [newDocId, setNewDocId] = useState("");
  const [newDocContent, setNewDocContent] = useState("");
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [customRelayUrl, setCustomRelayUrl] = useState(relayUrl);
  const [editingSecretKey, setEditingSecretKey] = useState(false);
  const [secretKeyInput, setSecretKeyInput] = useState("");

  // Track hydration
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
    setCustomRelayUrl(relayUrl);
  }, [relayUrl]);

  // Generate keys on mount if none exist
  useEffect(() => {
    if (isHydrated && !secretKey) {
      generateKeys();
    }
  }, [isHydrated, secretKey, generateKeys]);

  const handleConnect = () => {
    if (customRelayUrl !== relayUrl) {
      setRelayUrl(customRelayUrl);
    }
    sync();
    toast.success("Connecting to relay...");
  };

  const handleDisconnect = () => {
    disconnect();
    toast.info("Disconnected from relay");
  };

  const handleCreateDocument = async () => {
    if (!newDocId.trim() || !newDocContent.trim()) {
      toast.error("Please enter both document ID and content");
      return;
    }

    try {
      await createDocument(newDocId.trim(), newDocContent.trim());
      toast.success("Document created!");
      setNewDocId("");
      setNewDocContent("");
    } catch (e) {
      toast.error(`Failed to create document: ${e}`);
    }
  };

  const handleUpdateDocument = async (docId: string) => {
    if (!editContent.trim()) {
      toast.error("Content cannot be empty");
      return;
    }

    try {
      await updateDocument(docId, editContent.trim());
      toast.success("Document updated!");
      setEditingDocId(null);
      setEditContent("");
    } catch (e) {
      toast.error(`Failed to update document: ${e}`);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await deleteDocument(docId);
      toast.success("Document deleted!");
    } catch (e) {
      toast.error(`Failed to delete document: ${e}`);
    }
  };

  const startEditing = (docId: string, content: string) => {
    setEditingDocId(docId);
    setEditContent(content);
  };

  const handleEditSecretKey = () => {
    setSecretKeyInput(secretKey || "");
    setEditingSecretKey(true);
  };

  const handleSaveSecretKey = () => {
    if (secretKeyInput.trim()) {
      try {
        importSecretKey(secretKeyInput.trim());
        toast.success("Secret key updated");
        setEditingSecretKey(false);
      } catch {
        toast.error("Invalid secret key format");
      }
    }
  };

  const handleCancelSecretKey = () => {
    setEditingSecretKey(false);
    setSecretKeyInput("");
  };

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl py-8 px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">NIP-DB Example</h1>
          <p className="text-muted-foreground mt-2">
            Document synchronization over Nostr with CouchDB-style conflict resolution
          </p>
        </div>

        {/* Connection Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Identity & Connection
            </CardTitle>
            <CardDescription>
              Your Nostr identity and relay connection
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {secretKey && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Secret Key
                </label>
                {editingSecretKey ? (
                  <div className="mt-1 space-y-2">
                    <Input
                      value={secretKeyInput}
                      onChange={(e) => setSecretKeyInput(e.target.value)}
                      placeholder="Enter secret key (hex)"
                      className="font-mono text-xs"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveSecretKey}>
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleCancelSecretKey}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 mt-1">
                    <code className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all">
                      {secretKey}
                    </code>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={handleEditSecretKey}
                    >
                      <Edit3 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}
            {publicKey && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Public Key
                </label>
                <code className="block mt-1 p-2 bg-muted rounded text-xs font-mono break-all">
                  {publicKey}
                </code>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Relay URL
              </label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={customRelayUrl}
                  onChange={(e) => setCustomRelayUrl(e.target.value)}
                  placeholder="ws://localhost:4000"
                  disabled={connectionState === "connected"}
                />
                {connectionState === "connected" ? (
                  <Button variant="outline" onClick={handleDisconnect}>
                    <PlugZap className="h-4 w-4" />
                    Disconnect
                  </Button>
                ) : (
                  <Button onClick={handleConnect}>
                    <Plug className="h-4 w-4" />
                    {connectionState === "connecting" ? "Connecting..." : "Connect"}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Badge
              variant={
                connectionState === "connected"
                  ? "default"
                  : connectionState === "connecting"
                    ? "secondary"
                    : "outline"
              }
            >
              {connectionState === "connected" && <CheckCircle className="h-3 w-3" />}
              {connectionState}
            </Badge>
          </CardFooter>
        </Card>

        {/* Create Document Card */}
        {connectionState === "connected" && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Create Document
              </CardTitle>
              <CardDescription>
                Create a new syncable document
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Document ID</label>
                <Input
                  value={newDocId}
                  onChange={(e) => setNewDocId(e.target.value)}
                  placeholder="my-unique-doc-id"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Content</label>
                <Textarea
                  value={newDocContent}
                  onChange={(e) => setNewDocContent(e.target.value)}
                  placeholder="Enter your document content..."
                  className="mt-1"
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleCreateDocument}>
                <Plus className="h-4 w-4" />
                Create Document
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Documents List */}
        {connectionState === "connected" && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Documents ({documents.length})
            </h2>

            {documents.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No documents yet. Create one above!
                </CardContent>
              </Card>
            ) : (
              documents.map((doc) => {
                const revisions = getRevisions(doc.id);
                const isEditing = editingDocId === doc.id;

                return (
                  <Card key={doc.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle>{doc.id}</CardTitle>
                          <CardDescription className="mt-1">
                            Revision: {doc.revisionId}
                          </CardDescription>
                        </div>
                        <div className="flex gap-2">
                          {!isEditing && (
                            <>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                onClick={() => startEditing(doc.id, doc.content)}
                              >
                                <Edit3 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                onClick={() => handleDeleteDocument(doc.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {isEditing ? (
                        <div className="space-y-4">
                          <Textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="min-h-24"
                          />
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleUpdateDocument(doc.id)}
                            >
                              Save
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setEditingDocId(null);
                                setEditContent("");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap bg-muted p-3 rounded">
                          {doc.content}
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="flex-col items-stretch gap-3">
                      <Collapsible>
                        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group w-full">
                          <History className="h-3 w-3" />
                          {revisions.length} revision(s)
                          <ChevronDown className="h-3 w-3 ml-auto transition-transform group-data-[state=open]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-3">
                          <div className="space-y-2 max-h-64 overflow-auto">
                            {revisions
                              .slice()
                              .sort((a, b) => b.createdAt - a.createdAt)
                              .map((rev, index) => (
                                <div
                                  key={rev.eventId}
                                  className={`text-xs p-2 rounded border ${
                                    rev.revisionId === doc.revisionId
                                      ? "bg-primary/10 border-primary/30"
                                      : "bg-muted/50"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <Badge
                                      variant={
                                        rev.revisionId === doc.revisionId
                                          ? "default"
                                          : "outline"
                                      }
                                      className="font-mono text-[10px] px-1"
                                    >
                                      {rev.revisionId}
                                    </Badge>
                                    {rev.revisionId === doc.revisionId && (
                                      <Badge variant="secondary" className="text-[10px] px-1">
                                        current
                                      </Badge>
                                    )}
                                    {rev.deleted && (
                                      <Badge variant="destructive" className="text-[10px] px-1">
                                        deleted
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-muted-foreground mb-1">
                                    {new Date(rev.createdAt * 1000).toLocaleString()}
                                  </div>
                                  {rev.prevRevisionIds.length > 0 && (
                                    <div className="text-muted-foreground">
                                      Parent{rev.prevRevisionIds.length > 1 ? "s" : ""}:{" "}
                                      {rev.prevRevisionIds.map((p) => p.slice(0, 12)).join(", ")}
                                    </div>
                                  )}
                                  <div className="mt-1 text-foreground truncate">
                                    {rev.content || <em className="text-muted-foreground">(empty)</em>}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </CardFooter>
                  </Card>
                );
              })
            )}
          </div>
        )}

        {/* Not connected message */}
        {connectionState !== "connected" && (
          <Card>
            <CardContent className="py-12 text-center">
              <Plug className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Connect to a relay to start syncing documents
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
