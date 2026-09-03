import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/api";
import { Lock, KeyRound, CheckCircle, ArrowLeft, RefreshCw } from "lucide-react";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const tokenParam = searchParams.get("token") || "";
  const [token, setToken] = useState(tokenParam);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (tokenParam) {
      setToken(tokenParam);
    }
  }, [tokenParam]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token && !code) {
      toast({ title: "Token or Code Required", description: "Please enter your 6-digit code or use the email link", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Password Too Short", description: "New password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords Do Not Match", description: "Please confirm your new password", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          token: token.trim(),
          code: code.trim(),
          newPassword: password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Password reset failed");
      }

      setIsSuccess(true);
      toast({
        title: "Password Updated",
        description: "Your password has been changed successfully.",
      });
    } catch (err: any) {
      toast({
        title: "Reset Failed",
        description: err.message || "Network error",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center py-12 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <img src="/logo-master.png" alt="Just Legal Solutions" className="h-16 w-16 mx-auto rounded-xl shadow-xs" />
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
            Set New Password
          </h1>
          <p className="text-xs text-slate-500">
            Choose a strong password with at least 8 characters
          </p>
        </div>

        <Card className="border-slate-200 shadow-md">
          <CardHeader className="pb-4 border-b bg-slate-50/50">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-5 w-5 text-blue-600" />
              Choose New Password
            </CardTitle>
            <CardDescription className="text-xs">
              Enter your reset credentials and desired password
            </CardDescription>
          </CardHeader>

          {isSuccess ? (
            <CardContent className="pt-6 pb-6 text-center space-y-4">
              <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
                <CheckCircle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">Password Changed!</h3>
                <p className="text-xs text-slate-500">
                  All previous sessions were safely revoked. You can now log in with your new password.
                </p>
              </div>
              <div className="pt-2">
                <Button onClick={() => navigate("/login")} className="w-full bg-blue-600 hover:bg-blue-700 h-10 font-bold text-xs">
                  Sign In to ServeTracker
                </Button>
              </div>
            </CardContent>
          ) : (
            <form onSubmit={handleReset}>
              <CardContent className="space-y-4 pt-5">
                {!token && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">6-Digit Verification Code</Label>
                    <div className="relative">
                      <KeyRound className="h-4 w-4 absolute left-3 top-3 text-slate-400" />
                      <Input
                        required
                        maxLength={6}
                        placeholder="123456"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="h-10 pl-9 font-mono tracking-widest text-base font-bold"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">New Password (min 8 chars)</Label>
                  <Input
                    required
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Confirm New Password</Label>
                  <Input
                    required
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-10 text-sm"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex flex-col gap-3 pt-4 border-t bg-slate-50/50">
                <Button type="submit" disabled={isLoading} className="w-full h-10 bg-blue-600 hover:bg-blue-700 font-bold text-sm">
                  {isLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Updating Password...
                    </>
                  ) : (
                    "Update Password"
                  )}
                </Button>
                <div className="text-center">
                  <Link to="/login" className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 font-semibold">
                    <ArrowLeft className="h-3 w-3" /> Back to Sign In
                  </Link>
                </div>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
