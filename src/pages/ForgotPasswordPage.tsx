import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/api";
import { KeyRound, Mail, ArrowLeft, CheckCircle, RefreshCw } from "lucide-react";

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) {
      toast({ title: "Required field", description: "Please enter your email or username", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: identifier.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send reset email");
      }
      setSubmitted(true);
      toast({
        title: "Instructions Sent",
        description: "If an active account exists, password reset instructions were emailed.",
      });
    } catch (err: any) {
      toast({
        title: "Request failed",
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
            Reset Your Password
          </h1>
          <p className="text-xs text-slate-500">
            Enter your registered email address or username to receive a reset code
          </p>
        </div>

        <Card className="border-slate-200 shadow-md">
          <CardHeader className="pb-4 border-b bg-slate-50/50">
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-blue-600" />
              Password Recovery
            </CardTitle>
            <CardDescription className="text-xs">
              We'll send a 6-digit code and direct link to your email
            </CardDescription>
          </CardHeader>

          {submitted ? (
            <CardContent className="pt-6 pb-6 text-center space-y-4">
              <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
                <CheckCircle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">Check Your Email</h3>
                <p className="text-xs text-slate-500">
                  If an account exists for <strong>{identifier}</strong>, you will receive an email with your 6-digit code shortly.
                </p>
              </div>
              <div className="pt-2 flex flex-col gap-2">
                <Button onClick={() => navigate("/reset-password")} className="w-full bg-blue-600 hover:bg-blue-700 h-10 font-bold text-xs">
                  Enter 6-Digit Code & Reset Password
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSubmitted(false)} className="text-xs text-slate-500">
                  Try another email
                </Button>
              </div>
            </CardContent>
          ) : (
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4 pt-5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Email Address or Username</Label>
                  <div className="relative">
                    <Mail className="h-4 w-4 absolute left-3 top-3 text-slate-400" />
                    <Input
                      required
                      placeholder="e.g. john@example.com or jdoe_server"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      className="h-10 pl-9 text-sm"
                    />
                  </div>
                </div>
              </CardContent>

              <CardFooter className="flex flex-col gap-3 pt-4 border-t bg-slate-50/50">
                <Button type="submit" disabled={isLoading} className="w-full h-10 bg-blue-600 hover:bg-blue-700 font-bold text-sm">
                  {isLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Sending Instructions...
                    </>
                  ) : (
                    "Send Reset Code"
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
