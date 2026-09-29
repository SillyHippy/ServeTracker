import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Building2, Mail, Send, CheckCircle2, ShieldAlert, Upload, Trash2 } from "lucide-react";

export interface OrgSettingsData {
  organization: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
  };
  branding: {
    companyName: string;
    contactPhone: string;
    dispatchEmail: string;
    logoUrl?: string;
    omitAffidavitFooter: boolean;
  };
  emailStatus: {
    resendConfigured: boolean;
    resendFromEmail: string;
    brevoConfigured: boolean;
    brevoFromEmail: string;
    mailjetConfigured: boolean;
    mailjetFromEmail: string;
  };
}

export interface OrgSettingsPayload {
  branding: {
    companyName: string;
    contactPhone: string;
    dispatchEmail: string;
    logoUrl?: string;
    omitAffidavitFooter: boolean;
  };
  email: {
    resendFromEmail: string;
    brevoFromEmail: string;
    mailjetFromEmail: string;
    resendApiKey?: string;
    brevoApiKey?: string;
    mailjetApiKey?: string;
    mailjetSecretKey?: string;
  };
}

export const TenantBrandingSettings: React.FC = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [dispatchEmail, setDispatchEmail] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [omitAffidavitFooter, setOmitAffidavitFooter] = useState(false);

  const [resendApiKey, setResendApiKey] = useState("");
  const [resendFromEmail, setResendFromEmail] = useState("");

  const [brevoApiKey, setBrevoApiKey] = useState("");
  const [brevoFromEmail, setBrevoFromEmail] = useState("");

  const [mailjetApiKey, setMailjetApiKey] = useState("");
  const [mailjetSecretKey, setMailjetSecretKey] = useState("");
  const [mailjetFromEmail, setMailjetFromEmail] = useState("");

  const [emailStatus, setEmailStatus] = useState<OrgSettingsData["emailStatus"] | null>(null);
  const [testRecipient, setTestRecipient] = useState("");

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/org/settings");
      if (!res.ok) throw new Error("Failed to load settings");
      const data: OrgSettingsData = await res.json();

      setCompanyName(data.branding.companyName || data.organization.name || "");
      setContactPhone(data.branding.contactPhone || "");
      setDispatchEmail(data.branding.dispatchEmail || "");
      setLogoUrl(data.branding.logoUrl || "");
      setOmitAffidavitFooter(!!data.branding.omitAffidavitFooter);

      setResendFromEmail(data.emailStatus.resendFromEmail || "");
      setBrevoFromEmail(data.emailStatus.brevoFromEmail || "");
      setMailjetFromEmail(data.emailStatus.mailjetFromEmail || "");

      setEmailStatus(data.emailStatus);
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      const payload: OrgSettingsPayload = {
        branding: {
          companyName,
          contactPhone,
          dispatchEmail,
          logoUrl,
          omitAffidavitFooter,
        },
        email: {
          resendFromEmail,
          brevoFromEmail,
          mailjetFromEmail,
        },
      };

      if (resendApiKey) payload.email.resendApiKey = resendApiKey;
      if (brevoApiKey) payload.email.brevoApiKey = brevoApiKey;
      if (mailjetApiKey) payload.email.mailjetApiKey = mailjetApiKey;
      if (mailjetSecretKey) payload.email.mailjetSecretKey = mailjetSecretKey;

      const res = await fetch("/api/org/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Failed to update organization settings");

      toast({
        title: "Settings Saved",
        description: "Branding and email settings updated successfully.",
      });

      setResendApiKey("");
      setBrevoApiKey("");
      setMailjetApiKey("");
      setMailjetSecretKey("");
      await fetchSettings();
    } catch (err: unknown) {
      toast({
        title: "Save Failed",
        description: (err instanceof Error && err.message) || String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testRecipient) {
      toast({
        title: "Recipient Required",
        description: "Please enter an email address to send the test message to.",
        variant: "destructive",
      });
      return;
    }

    try {
      setTestingEmail(true);
      const res = await fetch("/api/org/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testRecipient }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Email delivery failed");
      }

      toast({
        title: "Test Email Dispatched",
        description: `Successfully delivered via provider: ${data.provider.toUpperCase()}`,
      });
    } catch (err: unknown) {
      toast({
        title: "Test Failed",
        description: (err instanceof Error && err.message) || String(err),
        variant: "destructive",
      });
    } finally {
      setTestingEmail(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Loading organization configuration...
        </CardContent>
      </Card>
    );
  }

  const configuredCount = [
    emailStatus?.resendConfigured,
    emailStatus?.brevoConfigured,
    emailStatus?.mailjetConfigured,
  ].filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Firm Identity & White-Labeling */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            <CardTitle>Firm Identity & White-Labeling</CardTitle>
          </div>
          <CardDescription>
            Customize your company branding across affidavits, street field sheets, client notifications, and EXIF metadata.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company / Agency Name</Label>
              <Input
                id="companyName"
                placeholder="e.g. Acme Process Service LLC"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Appears on field sheets, customer notifications, and affidavit headers.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactPhone">Dispatch / Contact Phone</Label>
              <Input
                id="contactPhone"
                placeholder="e.g. (918) 555-0199"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Printed on field sheets and affidavit footers for server contact.</p>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="dispatchEmail">Support & Notification Reply-To Email</Label>
              <Input
                id="dispatchEmail"
                type="email"
                placeholder="e.g. dispatch@acmeprocess.com"
                value={dispatchEmail}
                onChange={(e) => setDispatchEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="logoUrl">Firm Brand Logo</Label>
              <div className="flex gap-2">
                <Input
                  id="logoUrl"
                  placeholder="https://example.com/logo.png or choose a file below"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <input
                  type="file"
                  id="logoFileInput"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) {
                      toast({
                        title: "File too large",
                        description: "Logo file must be under 2MB",
                        variant: "destructive",
                      });
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      if (ev.target?.result) {
                        setLogoUrl(String(ev.target.result));
                        toast({
                          title: "Logo loaded",
                          description: "Logo file loaded. Click 'Save Changes' to update.",
                        });
                      }
                    };
                    reader.readAsDataURL(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById("logoFileInput")?.click()}
                >
                  <Upload className="w-4 h-4 mr-2" /> Upload Logo File
                </Button>
                {logoUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      setLogoUrl("");
                      toast({
                        title: "Logo removed",
                        description: "Click 'Save Changes' to commit removal to database.",
                      });
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Remove Logo
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Displayed on street field sheets, client email notifications, and invoices.</p>
              {logoUrl && (
                <div className="mt-2 p-2 border rounded-md bg-muted/20 inline-block">
                  <p className="text-[10px] text-muted-foreground mb-1 font-medium">Logo Preview:</p>
                  <img src={logoUrl} alt="Logo Preview" className="max-h-12 max-w-[200px] object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
                </div>
              )}
            </div>
          </div>

          <Separator className="my-2" />

          <div className="flex items-start space-x-3 pt-2">
            <Checkbox
              id="omitAffidavitFooter"
              checked={omitAffidavitFooter}
              onCheckedChange={(c) => setOmitAffidavitFooter(!!c)}
            />
            <div className="grid gap-1.5 leading-none">
              <label
                htmlFor="omitAffidavitFooter"
                className="text-sm font-medium leading-none cursor-pointer"
              >
                Omit firm contact footer on court affidavits (Clean Court Mode)
              </label>
              <p className="text-xs text-muted-foreground">
                When enabled, affidavits only display the server name, license number, and signature block without company contact details.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Outbound Email API Cascade */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-blue-600" />
              <CardTitle>Email Delivery Cascade (Free Tiers)</CardTitle>
            </div>
            <Badge variant={configuredCount > 0 ? "default" : "secondary"}>
              {configuredCount > 0 ? `${configuredCount} Provider(s) Active` : "System Fallback"}
            </Badge>
          </div>
          <CardDescription>
            Configure your own free API keys to send client serve notifications. Requests cascade automatically: Resend (100/day) &rarr; Brevo (300/day) &rarr; Mailjet (200/day).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Provider 1: Resend */}
          <div className="rounded-lg border p-4 space-y-3 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm flex items-center gap-2">
                <span>1. Resend API (Primary &bull; 100/day)</span>
                {emailStatus?.resendConfigured ? (
                  <Badge variant="outline" className="text-green-600 border-green-300 gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Configured
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Not set</Badge>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Resend API Key</Label>
                <Input
                  type="password"
                  placeholder={emailStatus?.resendConfigured ? "••••••••••••••••" : "re_12345..."}
                  value={resendApiKey}
                  onChange={(e) => setResendApiKey(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">From Address</Label>
                <Input
                  placeholder="notifications@yourdomain.com"
                  value={resendFromEmail}
                  onChange={(e) => setResendFromEmail(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Provider 2: Brevo */}
          <div className="rounded-lg border p-4 space-y-3 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm flex items-center gap-2">
                <span>2. Brevo API (Secondary Fallback &bull; 300/day)</span>
                {emailStatus?.brevoConfigured ? (
                  <Badge variant="outline" className="text-green-600 border-green-300 gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Configured
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Not set</Badge>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Brevo v3 API Key</Label>
                <Input
                  type="password"
                  placeholder={emailStatus?.brevoConfigured ? "••••••••••••••••" : "xkeysib-..."}
                  value={brevoApiKey}
                  onChange={(e) => setBrevoApiKey(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">From Address</Label>
                <Input
                  placeholder="updates@yourdomain.com"
                  value={brevoFromEmail}
                  onChange={(e) => setBrevoFromEmail(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Provider 3: Mailjet */}
          <div className="rounded-lg border p-4 space-y-3 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm flex items-center gap-2">
                <span>3. Mailjet API (Tertiary Fallback &bull; 200/day)</span>
                {emailStatus?.mailjetConfigured ? (
                  <Badge variant="outline" className="text-green-600 border-green-300 gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Configured
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Not set</Badge>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">API Key</Label>
                <Input
                  type="password"
                  placeholder={emailStatus?.mailjetConfigured ? "••••••••" : "API Key"}
                  value={mailjetApiKey}
                  onChange={(e) => setMailjetApiKey(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Secret Key</Label>
                <Input
                  type="password"
                  placeholder={emailStatus?.mailjetConfigured ? "••••••••" : "Secret Key"}
                  value={mailjetSecretKey}
                  onChange={(e) => setMailjetSecretKey(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">From Address</Label>
                <Input
                  placeholder="serve@yourdomain.com"
                  value={mailjetFromEmail}
                  onChange={(e) => setMailjetFromEmail(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Test Dispatch Bar */}
          <div className="rounded-lg border border-dashed p-4 flex flex-col sm:flex-row items-center gap-3 bg-white">
            <Input
              type="email"
              placeholder="Send test email to (e.g. you@firm.com)..."
              value={testRecipient}
              onChange={(e) => setTestRecipient(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestEmail}
              disabled={testingEmail || !testRecipient}
              className="gap-2 shrink-0"
            >
              <Send className="h-4 w-4" />
              {testingEmail ? "Testing..." : "Send Test Email"}
            </Button>
          </div>

          {/* Action Footer */}
          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 font-semibold px-6"
            >
              {saving ? "Saving Settings..." : "Save All Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
