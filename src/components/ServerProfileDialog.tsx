import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { ServerProfile } from "@/types/ServerProfile";
import SignatureStatusBadge from "@/components/SignatureStatusBadge";
import { KeyRound, LogOut, RefreshCw, ShieldX, UserX, UserCheck, Loader2, PenLine } from "lucide-react";
import { AdminServerSignatureDialog } from "@/components/AdminServerSignatureDialog";

interface Props {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  /** Admin viewing own profile gets self-session controls. */
  isSelf?: boolean;
}

export const ServerProfileDialog: React.FC<Props> = ({ userId, open, onOpenChange, onChanged, isSelf }) => {
  const [profile, setProfile] = useState<ServerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [isSigModalOpen, setIsSigModalOpen] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    if (!open) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await api.getUserDetail(userId);
      // GET /api/users/:id returns the user object at the top level (not { user }).
      const raw = res as unknown as Record<string, unknown>;
      const user = (raw && typeof raw === "object" && raw.user && typeof raw.user === "object"
        ? raw.user
        : raw) as unknown as ServerProfile;
      if (!user || !user.id) {
        throw new Error("Profile response was empty");
      }
      setProfile({
        ...user,
        legalName: user.legalName || "",
        displayName: user.displayName || "",
        email: user.email || "",
        phone: user.phone || "",
        licenseNumber: user.licenseNumber || "",
        licenseJurisdiction: user.licenseJurisdiction || "",
        licenseExpiresAt: user.licenseExpiresAt || "",
        serviceTerritory: Array.isArray(user.serviceTerritory) ? user.serviceTerritory : [],
        onboardingStatus: user.onboardingStatus || "pending",
        profileNotes: user.profileNotes || "",
      });
      if (isSelf) {
        try {
          const s = await api.getMySessions();
          setSessions(Array.isArray(s) ? s : s?.sessions || []);
        } catch {
          setSessions([]);
        }
      } else {
        setSessions([]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not load profile";
      setLoadError(msg);
      toast({ title: "Load failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [open, userId]);

  const save = async () => {
    if (!profile) return;
    setIsSaving(true);
    try {
      await api.updateUser(profile.id, {
        displayName: profile.displayName,
        email: profile.email,
        phone: profile.phone,
        legalName: profile.legalName,
        licenseNumber: profile.licenseNumber,
        licenseJurisdiction: profile.licenseJurisdiction,
        licenseExpiresAt: profile.licenseExpiresAt,
        serviceTerritory: profile.serviceTerritory,
        onboardingStatus: profile.onboardingStatus,
        profileNotes: profile.profileNotes,
      });
      toast({ title: "Profile saved", description: "Server profile updated successfully." });
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Could not save", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const resetPass = async () => {
    if (!resetPassword.trim() || resetPassword.length < 8) {
      toast({ title: "Invalid password", description: "New password must be at least 8 characters", variant: "destructive" });
      return;
    }
    try {
      await api.updateUser(profile!.id, { password: resetPassword.trim() });
      toast({ title: "Password reset", description: "The server must change this password on next login. All sessions were revoked." });
      setResetPassword("");
    } catch (err) {
      toast({ title: "Reset failed", description: err instanceof Error ? err.message : "Could not reset password", variant: "destructive" });
    }
  };

  const revokeSessions = async () => {
    try {
      await api.revokeUserSessions(profile!.id);
      toast({ title: "Sessions revoked", description: "All sessions for this account were revoked." });
    } catch (err) {
      toast({ title: "Revoke failed", description: err instanceof Error ? err.message : "Could not revoke sessions", variant: "destructive" });
    }
  };

  const revokeSignature = async () => {
    if (!confirm("Revoke this server's saved signature? Signed affidavits for their cases will stop rendering until a new signature is enrolled.")) return;
    try {
      await api.revokeUserSignature(profile!.id);
      toast({ title: "Signature revoked", description: "The saved signature was revoked." });
      load();
    } catch (err) {
      toast({ title: "Revoke failed", description: err instanceof Error ? err.message : "Could not revoke signature", variant: "destructive" });
    }
  };

  const toggleActive = async () => {
    if (!profile) return;
    try {
      await api.updateUser(profile.id, { isActive: !profile.isActive });
      toast({
        title: profile.isActive ? "Account deactivated" : "Account activated",
        description: profile.isActive ? "The server can no longer log in or access cases." : "The server can log in again.",
      });
      load();
      onChanged();
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "Could not change status", variant: "destructive" });
    }
  };

  const revokeOneSession = async (sessionId: string) => {
    try {
      await api.revokeOtherSessions(sessionId);
      toast({ title: "Session revoked", description: "That device session was revoked." });
      load();
    } catch (err) {
      toast({ title: "Revoke failed", description: err instanceof Error ? err.message : "Could not revoke session", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Server Profile — {profile?.displayName || "…"}</DialogTitle>
          <DialogDescription>
            {profile?.username} · {profile?.role === "admin" ? "Administrator" : "Field Server"}
            {profile && (
              <span className="ml-2">
                <SignatureStatusBadge
                  enrolled={!!profile.signatureStatus?.enrolled}
                  revoked={!!profile.signatureStatus?.revoked}
                  updatedAt={profile.signatureStatus?.updatedAt}
                />
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading profile…
          </div>
        ) : loadError || !profile ? (
          <div className="py-10 text-center text-sm text-muted-foreground space-y-3">
            <p>{loadError || "Could not load this profile."}</p>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </div>
        ) : (
          <div className="space-y-5 py-2 text-sm">
            {/* Identity + contact */}
            <div className="space-y-3">
              <h4 className="font-bold text-xs uppercase tracking-wide text-slate-500">Identity & Contact</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Legal Name</Label>
                  <Input value={profile.legalName} onChange={(e) => setProfile({ ...profile, legalName: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Display Name</Label>
                  <Input value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Mobile</Label>
                  <Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
                </div>
              </div>
            </div>

            {/* License */}
            <div className="space-y-3">
              <h4 className="font-bold text-xs uppercase tracking-wide text-slate-500">
                Process-Server Credentials{" "}
                <Badge variant={profile.licenseStatus === "expired" ? "destructive" : profile.licenseStatus === "expires_soon" ? "secondary" : "default"} className="ml-1 text-[10px]">
                  {profile.licenseStatus || "missing"}
                </Badge>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>License Number</Label>
                  <Input value={profile.licenseNumber} onChange={(e) => setProfile({ ...profile, licenseNumber: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Jurisdiction</Label>
                  <Input value={profile.licenseJurisdiction} onChange={(e) => setProfile({ ...profile, licenseJurisdiction: e.target.value.toUpperCase() })} maxLength={2} />
                </div>
                <div className="space-y-1">
                  <Label>License Expiration</Label>
                  <Input type="date" value={profile.licenseExpiresAt} onChange={(e) => setProfile({ ...profile, licenseExpiresAt: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Territory (comma-separated)</Label>
                  <Input
                    value={(profile.serviceTerritory || []).join(", ")}
                    onChange={(e) => setProfile({ ...profile, serviceTerritory: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  />
                </div>
              </div>
            </div>

            {/* Admin-only notes + onboarding */}
            <div className="space-y-3">
              <h4 className="font-bold text-xs uppercase tracking-wide text-slate-500">Administration</h4>
              <div className="space-y-1">
                <Label>Internal Notes (admin-only)</Label>
                <Textarea rows={2} value={profile.profileNotes} onChange={(e) => setProfile({ ...profile, profileNotes: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Onboarding Status</Label>
                  <Select value={profile.onboardingStatus} onValueChange={(v: string) => setProfile({ ...profile, onboardingStatus: v as ServerProfile["onboardingStatus"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending setup</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Last Activity</Label>
                  <div className="pt-2 text-xs text-slate-600">
                    {profile.lastActivityAt ? new Date(profile.lastActivityAt).toLocaleString() : "Never"}
                    {profile.activeCaseCount !== undefined && <div>Active cases: {profile.activeCaseCount}</div>}
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
              {profile.role === "server" && (
                <>
                  <Button variant="outline" size="sm" onClick={toggleActive}>
                    {profile.isActive ? <><UserX className="h-4 w-4 mr-1" /> Deactivate</> : <><UserCheck className="h-4 w-4 mr-1" /> Activate</>}
                  </Button>
                  <Button variant="outline" size="sm" onClick={revokeSessions}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Revoke all sessions
                  </Button>
                  <Button variant="outline" size="sm" className="text-blue-600 hover:text-blue-700 bg-blue-50/50" onClick={() => setIsSigModalOpen(true)}>
                    <PenLine className="h-4 w-4 mr-1" /> {profile.signatureStatus?.enrolled ? "Replace signature" : "Upload signature"}
                  </Button>
                  {profile.signatureStatus?.enrolled && (
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={revokeSignature}>
                      <ShieldX className="h-4 w-4 mr-1" /> Revoke signature
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Password reset */}
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <Label>Reset Password (revokes sessions, forces change on next login)</Label>
              <div className="flex gap-2">
                <Input type="password" placeholder="New temporary password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
                <Button variant="outline" size="sm" onClick={resetPass}><KeyRound className="h-4 w-4 mr-1" /> Reset</Button>
              </div>
            </div>

            {/* Sessions (self only) */}
            {isSelf && sessions.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <h4 className="font-bold text-xs uppercase tracking-wide text-slate-500">My Sessions</h4>
                {sessions.map((s) => (
                  <div key={s.sessionId} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg p-2">
                    <div>
                      <div className="font-semibold">{s.current ? "This device (current)" : `Device · ${new Date(s.createdAt).toLocaleString()}`}</div>
                      <div className="text-slate-500">Last seen {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "never"} · Expires {new Date(s.expiresAt).toLocaleString()}</div>
                    </div>
                    {!s.current && (
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => revokeOneSession(s.sessionId)}>
                        <LogOut className="h-3.5 w-3.5" /> Revoke
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={save} disabled={isSaving || !profile}>
            {isSaving ? "Saving..." : "Save Profile"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {profile && (
        <AdminServerSignatureDialog
          userId={profile.id}
          serverName={profile.displayName || profile.username}
          open={isSigModalOpen}
          onOpenChange={setIsSigModalOpen}
          onChanged={() => {
            void load();
            onChanged();
          }}
        />
      )}
    </Dialog>
  );
};

export default ServerProfileDialog;
