import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import SignatureEnrollmentDialog from "@/components/SignatureEnrollmentDialog";
import SignatureStatusBadge from "@/components/SignatureStatusBadge";
import {
  Copy, Check, PenLine, Loader2, Save, Lock, LogOut, Shield,
} from "lucide-react";
import { ServerProfile, SessionInfo, SignatureStatus } from "@/types/ServerProfile";

function asProfile(raw: unknown): ServerProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const user = (obj.user && typeof obj.user === "object" ? obj.user : obj) as Record<string, unknown>;
  if (!user.id) return null;
  const sigRaw = user.signatureStatus as SignatureStatus | undefined;
  return {
    id: String(user.id),
    username: String(user.username || ""),
    displayName: String(user.displayName || ""),
    role: (user.role as "admin" | "server") || "server",
    isActive: user.isActive !== false,
    createdAt: String(user.createdAt || ""),
    email: String(user.email || ""),
    phone: String(user.phone || ""),
    legalName: String(user.legalName || ""),
    licenseNumber: String(user.licenseNumber || ""),
    licenseJurisdiction: String(user.licenseJurisdiction || ""),
    licenseExpiresAt: String(user.licenseExpiresAt || ""),
    serviceTerritory: Array.isArray(user.serviceTerritory) ? (user.serviceTerritory as string[]) : [],
    onboardingStatus: (user.onboardingStatus as ServerProfile["onboardingStatus"]) || "pending",
    mustChangePassword: !!user.mustChangePassword,
    profileNotes: "",
    lastLoginAt: String(user.lastLoginAt || ""),
    lastActivityAt: String(user.lastActivityAt || ""),
    licenseStatus: (user.licenseStatus as ServerProfile["licenseStatus"]) || "missing",
    signatureStatus: {
      enrolled: !!sigRaw?.enrolled,
      revoked: !!sigRaw?.revoked,
      updatedAt: sigRaw?.updatedAt || "",
    },
  };
}

export default function MyProfile() {
  const { refreshAuth } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<ServerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const raw = await api.getMyProfile();
      const parsed = asProfile(raw);
      if (!parsed) throw new Error("Profile response was empty");
      setProfile(parsed);
      try {
        const s = await api.getMySessions();
        setSessions(s.sessions || []);
      } catch {
        setSessions([]);
      }
    } catch (err) {
      toast({
        title: "Could not load profile",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const copyUsername = async () => {
    if (!profile?.username) return;
    try {
      await navigator.clipboard.writeText(profile.username);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: "Copied", description: `Login username: ${profile.username}` });
    } catch {
      toast({ title: "Copy failed", description: profile.username, variant: "destructive" });
    }
  };

  const saveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setIsSaving(true);
    try {
      await api.updateMyProfile({
        displayName: profile.displayName,
        email: profile.email,
        phone: profile.phone,
      });
      await refreshAuth();
      toast({ title: "Profile saved", description: "Your contact details were updated." });
      await load();
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Could not update profile",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setPwSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated", description: "Use the new password next time you sign in." });
    } catch (err) {
      toast({
        title: "Password change failed",
        description: err instanceof Error ? err.message : "Check your current password",
        variant: "destructive",
      });
    } finally {
      setPwSaving(false);
    }
  };

  const revokeOthers = async () => {
    try {
      await api.revokeOtherSessions();
      toast({ title: "Other devices signed out" });
      await load();
    } catch (err) {
      toast({
        title: "Could not sign out other devices",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your profile…
      </div>
    );
  }

  if (!profile) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-muted-foreground mb-3">Could not load your profile.</p>
        <Button variant="outline" onClick={load}>Retry</Button>
      </Card>
    );
  }

  const enrolled = !!profile.signatureStatus?.enrolled && !profile.signatureStatus?.revoked;

  return (
    <div className="w-full pb-16 space-y-6 max-w-3xl">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Profile</h1>
        <p className="text-slate-500 text-xs sm:text-sm">
          Update your contact info, enroll your signature, and see the username you use to log in.
        </p>
      </div>

      <Card className="border-blue-200 bg-blue-50/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-700" /> Login username
          </CardTitle>
          <CardDescription>
            This is the username you type on the sign-in screen. It cannot be changed here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <code className="text-lg font-bold tracking-wide bg-white border border-blue-200 rounded-md px-3 py-1.5">
            {profile.username}
          </code>
          <Button size="sm" variant="outline" onClick={copyUsername}>
            {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Badge variant="secondary" className="uppercase text-[10px]">{profile.role}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <PenLine className="h-4 w-4 text-blue-600" /> Electronic signature
              </CardTitle>
              <CardDescription>
                Required to 1-click sign affidavits assigned to you. Does not notarize anything.
              </CardDescription>
            </div>
            <SignatureStatusBadge status={profile.signatureStatus} />
          </div>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setSigOpen(true)}>
            <PenLine className="h-4 w-4 mr-1" />
            {enrolled ? "Replace signature" : "Enroll my signature"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contact info</CardTitle>
          <CardDescription>You can update display name, email, and phone. License details are set by an administrator.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveContact} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Display name</Label>
                <Input
                  value={profile.displayName}
                  onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Legal name</Label>
                <Input value={profile.legalName || "—"} disabled className="bg-slate-50" />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Mobile</Label>
                <Input
                  value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                />
              </div>
            </div>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save contact info
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">License (read-only)</CardTitle>
          <CardDescription>Ask an administrator to update license number, jurisdiction, or expiration.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[11px] uppercase text-slate-500 font-semibold">License number</div>
            <div>{profile.licenseNumber || "Not on file"}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-slate-500 font-semibold">Jurisdiction</div>
            <div>{profile.licenseJurisdiction || "—"}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-slate-500 font-semibold">Expires</div>
            <div>{profile.licenseExpiresAt || "—"}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-slate-500 font-semibold">Status</div>
            <Badge variant={profile.licenseStatus === "missing" || profile.licenseStatus === "expired" ? "destructive" : "secondary"} className="text-[10px]">
              {profile.licenseStatus}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4" /> Change password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePw} className="space-y-3 max-w-md">
            <div className="space-y-1">
              <Label>Current password</Label>
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            <div className="space-y-1">
              <Label>New password</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoComplete="new-password" />
            </div>
            <div className="space-y-1">
              <Label>Confirm new password</Label>
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
            </div>
            <Button type="submit" variant="outline" disabled={pwSaving}>
              {pwSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Signed-in devices</CardTitle>
          <CardDescription>Sessions last 30 days until you sign out or an admin resets your password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No other session details available.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {sessions.map((s) => (
                <div key={s.sessionId} className="p-2 text-xs flex justify-between gap-2">
                  <span>
                    {s.current ? <strong>This device</strong> : "Other device"} · last seen{" "}
                    {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "—"}
                  </span>
                  <span className="text-slate-400">expires {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : "—"}</span>
                </div>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={revokeOthers}>
            <LogOut className="h-4 w-4 mr-1" /> Log out other devices
          </Button>
        </CardContent>
      </Card>

      <SignatureEnrollmentDialog
        open={sigOpen}
        onOpenChange={setSigOpen}
        onChanged={() => { load(); refreshAuth(); }}
        existing={{ enrolled, updatedAt: profile.signatureStatus?.updatedAt }}
      />
    </div>
  );
}
