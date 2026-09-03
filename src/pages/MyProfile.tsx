import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import SignatureEnrollmentDialog from "@/components/SignatureEnrollmentDialog";
import SignatureStatusBadge from "@/components/SignatureStatusBadge";
import {
  Copy, Check, PenLine, Loader2, Save, Lock, LogOut, Shield, MapPin, DollarSign,
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
    phoneSmsEnabled: user.phoneSmsEnabled !== false,
    googleLinked: !!user.googleLinked,
    googleEmail: String(user.googleEmail || ""),
    legalName: String(user.legalName || ""),
    licenseNumber: String(user.licenseNumber || ""),
    licenseJurisdiction: String(user.licenseJurisdiction || ""),
    licenseExpiresAt: String(user.licenseExpiresAt || ""),
    serviceTerritory: Array.isArray(user.serviceTerritory) ? (user.serviceTerritory as string[]) : [],
    onboardingStatus: (user.onboardingStatus as ServerProfile["onboardingStatus"]) || "pending",
    mustChangePassword: !!user.mustChangePassword,
    profileNotes: String(user.profileNotes || ""),
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
        phoneSmsEnabled: profile.phoneSmsEnabled,
        serviceTerritory: profile.serviceTerritory,
        profileNotes: profile.profileNotes,
        ...(profile.role === "admin"
          ? {
              licenseNumber: profile.licenseNumber,
              licenseJurisdiction: profile.licenseJurisdiction,
              licenseExpiresAt: profile.licenseExpiresAt,
            }
          : {}),
      });
      await refreshAuth();
      toast({ title: "Profile saved", description: "Your profile, license, and rates were updated." });
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
      toast({ title: "Other devices signed out", description: "Only this device stays signed in." });
      await load();
    } catch (err) {
      toast({
        title: "Could not sign out other devices",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    }
  };

  const revokeOne = async (sessionId: string) => {
    try {
      await api.revokeOtherSessions(sessionId);
      toast({ title: "Device signed out" });
      await load();
    } catch (err) {
      toast({
        title: "Could not sign out that device",
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
            <Shield className="h-4 w-4 text-blue-700" /> Login username & Linked Accounts
          </CardTitle>
          <CardDescription>
            This is the username you type on the sign-in screen, along with any linked Single Sign-On accounts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-lg font-bold tracking-wide bg-white border border-blue-200 rounded-md px-3 py-1.5">
              {profile.username}
            </code>
            <Button size="sm" variant="outline" onClick={copyUsername}>
              {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Badge variant="secondary" className="uppercase text-[10px]">{profile.role}</Badge>
          </div>

          <div className="pt-2 border-t border-blue-200/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <div>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Google Account</p>
                <p className="text-[11px] text-muted-foreground">
                  {profile.googleLinked
                    ? `Linked to Google (${profile.googleEmail || "Active"})`
                    : "Not linked. You can sign in with Google anytime."}
                </p>
              </div>
            </div>
            {profile.googleLinked ? (
              <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px]">
                Linked
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => {
                  window.location.href = `/api/auth/sign-in/social?provider=google&callbackURL=${encodeURIComponent(window.location.href)}`;
                }}
              >
                Link Google Account
              </Button>
            )}
          </div>
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
          <CardTitle className="text-base">Contact, Territory & Service Rates</CardTitle>
          <CardDescription>You can update display name, email, phone, service areas, and rates. License details are managed by an administrator.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveContact} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold">Display name</Label>
                <Input
                  value={profile.displayName}
                  onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
                  required
                  className="h-10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">Legal name</Label>
                <Input value={profile.legalName || "—"} disabled className="bg-slate-50 h-10 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">Email</Label>
                <Input
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                  className="h-10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">Mobile Phone</Label>
                <Input
                  value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                  className="h-10 text-sm"
                />
              </div>
            </div>

            <div className="border-t pt-3 space-y-3">
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border">
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">SMS Dispatch Alerts</p>
                  <p className="text-[11px] text-muted-foreground">Receive instant cellular text messages on job assignment and urgent nudges.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profile.phoneSmsEnabled}
                    onChange={(e) => setProfile({ ...profile, phoneSmsEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-emerald-600" /> Covered Counties / Service Territory
                </Label>
                <Input
                  placeholder="e.g. Tulsa, Rogers, Wagoner, Creek, Osage"
                  value={profile.serviceTerritory.join(", ")}
                  onChange={(e) => setProfile({ ...profile, serviceTerritory: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                  className="h-10 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">Separate multiple counties or cities with commas.</p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-blue-600" /> Service Rates & Pricing Notes
                </Label>
                <Textarea
                  placeholder="e.g. Rates: Standard $50 | Rush $85&#10;Pricing Details: 3 attempts included; $0.65/mi beyond 25 miles; available weekends."
                  value={profile.profileNotes}
                  onChange={(e) => setProfile({ ...profile, profileNotes: e.target.value })}
                  rows={3}
                  className="text-xs"
                />
                <p className="text-[11px] text-muted-foreground">Specify your standard fee, rush fee, mileage, or special dispatch notes for dispatchers.</p>
              </div>
            </div>

            <Button type="submit" disabled={isSaving} className="h-10 font-bold bg-blue-600 hover:bg-blue-700">
              {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save Profile & Rates
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Process Server License Credentials</CardTitle>
              <CardDescription>
                {profile.role === "admin"
                  ? "As an administrator, you can update your license badge number, jurisdiction, and expiration date directly."
                  : "Managed by your administrator for affidavit attestation compliance."}
              </CardDescription>
            </div>
            {profile.licenseStatus && (
              <Badge
                variant={
                  profile.licenseStatus === "missing" || profile.licenseStatus === "expired"
                    ? "destructive"
                    : profile.licenseStatus === "expires_soon"
                    ? "secondary"
                    : "outline"
                }
                className="text-[10px] uppercase font-bold"
              >
                {profile.licenseStatus.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {profile.role === "admin" ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold">License / Badge #</Label>
                <Input
                  placeholder="e.g. PSL-2026-001"
                  value={profile.licenseNumber}
                  onChange={(e) => setProfile({ ...profile, licenseNumber: e.target.value })}
                  className="h-10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">Jurisdiction / County</Label>
                <Input
                  placeholder="e.g. Tulsa County / Oklahoma"
                  value={profile.licenseJurisdiction}
                  onChange={(e) => setProfile({ ...profile, licenseJurisdiction: e.target.value })}
                  className="h-10 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">License Expiration</Label>
                <Input
                  type="date"
                  value={profile.licenseExpiresAt}
                  onChange={(e) => setProfile({ ...profile, licenseExpiresAt: e.target.value })}
                  className="h-10 text-sm"
                />
              </div>
              <div className="sm:col-span-3 pt-1">
                <Button
                  type="button"
                  onClick={saveContact}
                  disabled={isSaving}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 font-semibold"
                >
                  {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  Save License Info
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-[11px] uppercase text-slate-500 font-semibold">License number</div>
                <div className="font-mono font-medium">{profile.licenseNumber || "Not on file"}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-slate-500 font-semibold">Jurisdiction</div>
                <div>{profile.licenseJurisdiction || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-slate-500 font-semibold">Expires</div>
                <div>{profile.licenseExpiresAt || "—"}</div>
              </div>
            </div>
          )}
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

      <SignatureEnrollmentDialog
        open={sigOpen}
        onOpenChange={setSigOpen}
        onChanged={() => { load(); refreshAuth(); }}
        existing={{ enrolled, updatedAt: profile.signatureStatus?.updatedAt }}
      />
    </div>
  );
}
