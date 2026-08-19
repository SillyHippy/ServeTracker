import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Lock, User, ShieldCheck } from "lucide-react";
import { login } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50/50 p-4">
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
                Username <span className="text-xs text-muted-foreground">(Optional for Admin)</span>
              </label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  placeholder="admin or server username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-9"
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </label>
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

          <CardFooter className="pt-2">
            <Button className="w-full h-11 text-base font-medium" type="submit" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
