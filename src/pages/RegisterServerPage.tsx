import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Shield, UserPlus, PenLine, DollarSign, MapPin, CheckCircle, RefreshCw, Calendar } from "lucide-react";
import { SignatureCapture } from "@/components/SignatureCapture";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

export default function RegisterServerPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { refreshAuth } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || !displayName.trim()) {
      toast({ title: "Required fields", description: "Username, password, and name are required.", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (!acceptedTos) {
      toast({ title: "Terms required", description: "Accept the Terms of Service and Privacy Policy to continue.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/register-server`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: username.trim(),
          password,
          displayName: displayName.trim(),
          legalName: (legalName || displayName).trim(),
          email: email.trim(),
          phone: phone.trim(),
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
        throw new Error(data.error || "Registration failed");
      }

      toast({
        title: "Welcome to ServeTracker!",
        description: "Your server profile and credentials were saved successfully.",
      });

      // Seamless redirect to dashboard
      window.location.href = "/dashboard";
    } catch (err: any) {
      toast({
        title: "Registration failed",
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
            Field Server Onboarding
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Join Just Legal Solutions as a licensed private process server
          </p>
        </div>

        <div className="space-y-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <p className="text-xs text-center font-medium text-slate-600 dark:text-slate-400">
            Fast Track: Sign up or log in instantly with Google
          </p>
          <GoogleSignInButton label="Sign up with Google" />
          <div className="relative w-full my-2">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200 dark:border-slate-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-slate-900 px-2 text-muted-foreground font-semibold">
                Or fill manual application
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleRegister}>
          <Card className="border-slate-200 shadow-md">
            <CardHeader className="pb-4 border-b bg-slate-50/50">
              <CardTitle className="text-base flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-blue-600" />
                Server Profile & Licensing
              </CardTitle>
              <CardDescription className="text-xs">
                Enter your credentials to receive legal case assignments
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-5">
              {/* Account Credentials */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-username" className="text-xs font-bold">Username *</Label>
                  <Input
                    id="reg-username"
                    name="username"
                    required
                    placeholder="e.g. jdoe_server"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    autoComplete="username"
                    className="h-10 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-password" className="text-xs font-bold">Password (min 8 chars) *</Label>
                  <Input
                    id="reg-password"
                    name="password"
                    required
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className="h-10 text-sm"
                  />
                </div>
              </div>

              {/* Personal Contact */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-name" className="text-xs font-bold">Full Display / Server Name *</Label>
                  <Input
                    id="reg-name"
                    name="name"
                    required
                    placeholder="e.g. John Doe"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="name"
                    className="h-10 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-legal-name" className="text-xs font-bold">Legal Name (as on license)</Label>
                  <Input
                    id="reg-legal-name"
                    name="legal-name"
                    placeholder="e.g. Johnathan R. Doe"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    autoComplete="name"
                    className="h-10 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-email" className="text-xs font-bold">Email Address</Label>
                  <Input
                    id="reg-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    placeholder="john@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    className="h-10 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-tel" className="text-xs font-bold">Direct Mobile Phone</Label>
                  <Input
                    id="reg-tel"
                    name="tel"
                    type="tel"
                    inputMode="tel"
                    placeholder="(918) 555-0123"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    className="h-10 text-sm"
                  />
                </div>
              </div>

              {/* Process Server License */}
              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600">
                  <Shield className="h-4 w-4 text-blue-600" /> License Details
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">PSL License Number</Label>
                    <Input
                      placeholder="e.g. PSL-2026-99"
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      className="h-11 text-sm font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">County / Jurisdiction</Label>
                    <Input
                      placeholder="e.g. Tulsa County"
                      value={licenseJurisdiction}
                      onChange={(e) => setLicenseJurisdiction(e.target.value)}
                      className="h-11 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-slate-500" /> License Expiration Date
                  </Label>
                  <Input
                    type="date"
                    value={licenseExpiresAt}
                    onChange={(e) => setLicenseExpiresAt(e.target.value)}
                    className="h-11 text-sm bg-white dark:bg-slate-900 block w-full"
                  />
                </div>
              </div>

              {/* Service Areas & Pricing */}
              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600">
                  <MapPin className="h-4 w-4 text-emerald-600" /> Coverage Territory & Pricing
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Covered Counties / Cities</Label>
                  <Input
                    placeholder="e.g. Tulsa, Rogers, Wagoner, Creek, Osage"
                    value={serviceTerritory}
                    onChange={(e) => setServiceTerritory(e.target.value)}
                    className="h-10 text-sm"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Standard Serve Rate ($)</Label>
                    <div className="relative">
                      <DollarSign className="h-4 w-4 absolute left-3 top-3 text-slate-400" />
                      <Input
                        placeholder="50.00"
                        value={standardRate}
                        onChange={(e) => setStandardRate(e.target.value)}
                        className="h-10 pl-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Rush Serve Rate ($)</Label>
                    <div className="relative">
                      <DollarSign className="h-4 w-4 absolute left-3 top-3 text-slate-400" />
                      <Input
                        placeholder="85.00"
                        value={rushRate}
                        onChange={(e) => setRushRate(e.target.value)}
                        className="h-10 pl-8 text-sm"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Pricing & Service Notes</Label>
                  <Textarea
                    placeholder="e.g. Includes 3 attempts; mileage beyond 25 miles is $0.65/mi; available weekends."
                    value={rateNotes}
                    onChange={(e) => setRateNotes(e.target.value)}
                    rows={2}
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Electronic Signature Canvas */}
              <div className="border-t pt-4 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                  <PenLine className="h-4 w-4 text-purple-600" /> Draw Your Electronic Signature
                </div>
                <SignatureCapture value={signatureData} onChange={setSignatureData} />
                <p className="text-[11px] text-slate-400">
                  Draw your official signature above or upload a file. It will be saved securely for 1-click legal affidavit execution.
                </p>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3 pt-4 border-t bg-slate-50/50">
              <label className="flex items-start gap-2 text-xs text-slate-600 leading-snug cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={acceptedTos}
                  onChange={(e) => setAcceptedTos(e.target.checked)}
                  required
                />
                <span>
                  I agree to the{" "}
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
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Enrolling Profile...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" /> Complete Server Registration
                  </>
                )}
              </Button>
              <div className="text-center text-xs text-slate-500">
                Already have an account?{" "}
                <Link to="/login" className="text-blue-600 font-semibold hover:underline">
                  Sign in here
                </Link>
              </div>
            </CardFooter>
          </Card>
        </form>
      </div>
    </div>
  );
}
