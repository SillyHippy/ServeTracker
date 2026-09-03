import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { API_BASE, api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Shield, PenLine, DollarSign, MapPin, CheckCircle, RefreshCw, Calendar, Phone, FileBadge } from "lucide-react";
import { SignatureCapture } from "@/components/SignatureCapture";

export default function CompleteOnboardingPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, refreshAuth } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseJurisdiction, setLicenseJurisdiction] = useState("Tulsa County / Oklahoma");
  const [licenseExpiresAt, setLicenseExpiresAt] = useState("");
  const [serviceTerritory, setServiceTerritory] = useState("Tulsa, Rogers, Wagoner, Creek, Osage");
  const [standardRate, setStandardRate] = useState("50.00");
  const [rushRate, setRushRate] = useState("60.00");
  const [rateNotes, setRateNotes] = useState("3 attempts included, flat rate.");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [acceptedTos, setAcceptedTos] = useState(false);

  useEffect(() => {
    if (user) {
      if (user.displayName) {
        setDisplayName(user.displayName);
        setLegalName(user.displayName);
      }
      if (user.username && user.username.includes("@")) {
        setEmail(user.username);
      }
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      toast({ title: "Phone number required", description: "Mobile phone is required for automated dispatch alerts.", variant: "destructive" });
      return;
    }
    if (!licenseNumber.trim()) {
      toast({ title: "License number required", description: "Please enter your process server license or badge number.", variant: "destructive" });
      return;
    }
    if (!signatureData) {
      toast({ title: "Signature required", description: "Please draw and save your official e-signature below.", variant: "destructive" });
      return;
    }
    if (!acceptedTos) {
      toast({ title: "Terms required", description: "Please accept the Terms of Service to finalize your onboarding.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/me/complete-onboarding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          displayName: displayName.trim(),
          legalName: (legalName || displayName).trim(),
          email: email.trim(),
          phone: phone.trim(),
          phone_sms_enabled: 1,
          licenseNumber: licenseNumber.trim(),
          licenseJurisdiction: licenseJurisdiction.trim(),
          licenseExpiresAt: licenseExpiresAt.trim(),
          serviceTerritory: serviceTerritory.split(",").map((s) => s.trim()).filter(Boolean),
          standardRate: standardRate.trim(),
          rushRate: rushRate.trim(),
          rateNotes: rateNotes.trim(),
          signatureData: signatureData || "",
          accepted_tos: true,
          tos_version: "2026.1",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Onboarding submission failed");
      }

      await refreshAuth();
      toast({
        title: "Profile Complete!",
        description: "Welcome to ServeTracker. You are now active and ready for case assignments.",
      });

      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast({
        title: "Onboarding failed",
        description: err.message || "Network error",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8 px-4 flex flex-col justify-center items-center">
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center space-y-2">
          <img src="/logo-master.png" alt="Just Legal Solutions" className="h-16 w-16 mx-auto rounded-xl shadow-xs" />
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100">
            Complete Field Server Onboarding
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            You are signed in with Google. Complete your license & dispatch settings to activate your account.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <Card className="border-slate-200 shadow-md">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileBadge className="h-5 w-5 text-blue-600" /> Professional Credentials & Coverage
              </CardTitle>
              <CardDescription>
                Required for court-filed affidavits of service and automated SMS dispatch.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-bold">Display Name</Label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                    placeholder="e.g. John Doe"
                    className="h-10 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold">Legal Name (For Affidavits)</Label>
                  <Input
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    required
                    placeholder="Full legal name as licensed"
                    className="h-10 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-bold flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5 text-emerald-600" /> Mobile Phone (SMS Dispatch)
                  </Label>
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    placeholder="(918) 555-0199"
                    className="h-10 text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground">Used for instant text alerts on job assignments.</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold">Contact Email</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="server@domain.com"
                    className="h-10 text-sm"
                  />
                </div>
              </div>

              <div className="border-t pt-3 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">License Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-bold">License / Badge #</Label>
                    <Input
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      required
                      placeholder="e.g. PS-2026-44"
                      className="h-10 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold">Jurisdiction</Label>
                    <Input
                      value={licenseJurisdiction}
                      onChange={(e) => setLicenseJurisdiction(e.target.value)}
                      placeholder="Tulsa County / Oklahoma"
                      className="h-10 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-blue-600" /> Expiration Date
                    </Label>
                    <Input
                      type="date"
                      value={licenseExpiresAt}
                      onChange={(e) => setLicenseExpiresAt(e.target.value)}
                      className="h-10 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-3 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Coverage & Pricing</h3>
                <div className="space-y-1">
                  <Label className="text-xs font-bold flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-emerald-600" /> Covered Counties / Cities
                  </Label>
                  <Input
                    value={serviceTerritory}
                    onChange={(e) => setServiceTerritory(e.target.value)}
                    placeholder="e.g. Tulsa, Rogers, Wagoner, Creek, Osage"
                    className="h-10 text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground">Separate multiple counties with commas.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-bold flex items-center gap-1">
                      <DollarSign className="h-3.5 w-3.5 text-blue-600" /> Standard Serve Rate ($)
                    </Label>
                    <Input
                      value={standardRate}
                      onChange={(e) => setStandardRate(e.target.value)}
                      placeholder="50.00"
                      className="h-10 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold flex items-center gap-1">
                      <DollarSign className="h-3.5 w-3.5 text-orange-600" /> Rush Serve Rate ($)
                    </Label>
                    <Input
                      value={rushRate}
                      onChange={(e) => setRushRate(e.target.value)}
                      placeholder="85.00"
                      className="h-10 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-bold">Rates & Billing Notes</Label>
                  <Textarea
                    value={rateNotes}
                    onChange={(e) => setRateNotes(e.target.value)}
                    rows={2}
                    placeholder="Mileage terms, weekend availability, special attempt policies..."
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="border-t pt-3 space-y-2">
                <Label className="text-xs font-bold flex items-center gap-1">
                  <PenLine className="h-4 w-4 text-blue-600" /> Electronic Signature Canvas
                </Label>
                <p className="text-xs text-slate-500">
                  Draw your official signature once below. It will be stored securely for court-proof 1-click affidavit generation.
                </p>
                <div className="bg-slate-50 dark:bg-slate-900 border rounded-lg p-2">
                  <SignatureCapture value={signatureData} onChange={setSignatureData} />
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-4 border-t pt-4 bg-slate-50/50">
              <label className="flex items-start gap-2 text-xs text-slate-600 leading-snug cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={acceptedTos}
                  onChange={(e) => setAcceptedTos(e.target.checked)}
                  required
                />
                <span>
                  I certify my process server license is valid and agree to the{" "}
                  <Link to="/terms" target="_blank" className="text-blue-600 font-semibold hover:underline">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link to="/privacy" target="_blank" className="text-blue-600 font-semibold hover:underline">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>

              <Button type="submit" disabled={isLoading || !acceptedTos} className="w-full h-11 bg-blue-600 hover:bg-blue-700 font-bold text-sm">
                {isLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Activating Profile...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" /> Complete & Activate Account
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </div>
  );
}
