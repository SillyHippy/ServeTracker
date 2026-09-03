import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Lock, User, ShieldCheck, UserPlus } from "lucide-react";
import { login } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { status, mustChangePassword, refreshAuth } = useAuth();

  useEffect(() => {
    if (status === "authenticated") {
      navigate(mustChangePassword ? "/change-password" : "/dashboard", { replace: true });
    }
  }, [status, mustChangePassword, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await login(password, username.trim() || undefined);
      if (result.success) {
        const ok = await refreshAuth();
        const role = result.user?.role;
        const name = result.user?.displayName || "User";
        toast({
          title: "Login successful",
          description: `Welcome back, ${name}${role === "server" ? " (Field Server)" : ""}`,
          variant: "default",
        });
        if (ok) {
          if (result.user?.mustChangePassword) {
            navigate("/change-password", { replace: true });
          } else {
            navigate("/dashboard", { replace: true });
          }
        }
      } else {
        throw new Error("Incorrect login");
      }
    } catch {
      toast({
        title: "Authentication failed",
        description: "Invalid username or password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50/50 p-4 space-y-4">
      <Card className="w-full max-w-md shadow-lg border-muted">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">ServeTracker</CardTitle>
          <CardDescription>
            Sign in with your server account or administrator password
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium text-foreground">
                Username or Email <span className="text-xs text-muted-foreground">(Optional for Admin)</span>
              </label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  placeholder="admin, username, or email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-9"
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </label>
                <Link to="/forgot-password" className="text-xs text-blue-600 hover:underline font-medium">
                  Forgot Password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2 flex flex-col gap-3">
            <Button className="w-full h-11 text-base font-medium bg-blue-600 hover:bg-blue-700" type="submit" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign In with Password"}
            </Button>

            <div className="relative w-full my-2">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-200 dark:border-slate-800" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white dark:bg-slate-950 px-2 text-muted-foreground font-semibold">
                  Or continue with
                </span>
              </div>
            </div>

            <GoogleSignInButton />

            <div className="text-center text-xs text-slate-500 pt-2 border-t w-full">
              New field process server?{" "}
              <Link to="/join" className="text-blue-600 font-bold hover:underline inline-flex items-center gap-0.5">
                <UserPlus className="h-3 w-3 inline" /> Join & Onboard Here
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
