import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key, Plus, Trash2, Copy, Check, ExternalLink, ShieldCheck, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ApiKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string;
  created_at: string;
  last_used_at?: string;
  revoked_at?: string;
}

export function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const loadKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/org/api-keys");
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch (err) {
      console.error("Failed to load API keys:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/org/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName.trim(), scopes: ["all"] }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create API key");
      }
      setCreatedRawKey(data.apiKey);
      setKeyName("");
      loadKeys();
    } catch (err: unknown) {
      setError(err instanceof Error ? (err.message || "Failed to create API key") : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Are you sure you want to revoke this API key? Any active scripts or integrations using it will stop working immediately.")) {
      return;
    }
    try {
      const res = await fetch(`/api/org/api-keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        loadKeys();
      }
    } catch (err) {
      console.error("Failed to revoke key:", err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border border-slate-200 shadow-sm mt-6">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-600" />
            <div>
              <CardTitle className="text-lg">Developer REST API & Integrations</CardTitle>
              <CardDescription>
                Programmatically intake cases, query statuses, and log serves using Bearer API keys.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs flex items-center gap-1 text-slate-600 hover:text-indigo-600"
              onClick={() => window.open("/api/v1/docs", "_blank")}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              API Docs
            </Button>
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5"
              onClick={() => {
                setCreatedRawKey(null);
                setError("");
                setIsCreateOpen(true);
              }}
            >
              <Plus className="w-4 h-4" />
              Generate API Key
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-6 text-center text-sm text-slate-500">Loading API keys...</div>
        ) : keys.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
            <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-700">No API Keys Generated</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-3">
              Generate an API key to connect external practice management software (Clio, MyCase, Zapier) directly to ServeTracker.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCreatedRawKey(null);
                setError("");
                setIsCreateOpen(true);
              }}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Create First Key
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                  <th className="pb-3 pl-2">Name</th>
                  <th className="pb-3">Key Prefix</th>
                  <th className="pb-3">Created</th>
                  <th className="pb-3">Last Used</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3 text-right pr-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {keys.map((k) => {
                  const isRevoked = Boolean(k.revoked_at);
                  return (
                    <tr key={k.id} className="hover:bg-slate-50/60">
                      <td className="py-3 pl-2 font-medium text-slate-900">{k.name}</td>
                      <td className="py-3 font-mono text-xs text-slate-600">{k.key_prefix}</td>
                      <td className="py-3 text-xs text-slate-500">{new Date(k.created_at).toLocaleDateString()}</td>
                      <td className="py-3 text-xs text-slate-500">
                        {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never"}
                      </td>
                      <td className="py-3">
                        {isRevoked ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                            Revoked
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right pr-2">
                        {!isRevoked && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 px-2"
                            onClick={() => handleRevoke(k.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Modal for creating / displaying generated key */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{createdRawKey ? "Save Your API Key" : "Generate API Key"}</DialogTitle>
            <DialogDescription>
              {createdRawKey
                ? "Copy this key now. For security, you will not be able to view it again once this window is closed."
                : "Enter a descriptive label for this integration."}
            </DialogDescription>
          </DialogHeader>

          {createdRawKey ? (
            <div className="space-y-4 py-2">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-md flex items-start gap-2 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>Store this token securely in your environment variables. Never commit it to public repositories.</span>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Live API Key</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={createdRawKey}
                    className="font-mono text-xs bg-slate-50 select-all"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="bg-slate-900 text-white hover:bg-slate-800 shrink-0"
                    onClick={() => copyToClipboard(createdRawKey)}
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
                  </Button>
                </div>
              </div>

              <DialogFooter className="mt-4">
                <Button
                  className="w-full"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setCreatedRawKey(null);
                  }}
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4 py-2">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="keyName" className="text-xs font-semibold">Key Name / Description</Label>
                <Input
                  id="keyName"
                  placeholder="e.g. Clio Integration, Zapier Intake"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={creating || !keyName.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {creating ? "Generating..." : "Generate Key"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
