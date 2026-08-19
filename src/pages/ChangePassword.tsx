import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Lock, ShieldCheck, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, clearPasswordFlag, refreshAuth } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (newPassword.length < 8) {
        throw new Error("New password must be at least 8 characters");
      }
      if (newPassword !== confirmPassword) {
        throw new Error("New passwords do not match");
      }
      if (newPassword === currentPassword) {
        throw new Error("New password must be different from the current password");
      }
      const res = await api.changePassword(currentPassword, newPassword);
      if (!res.success) throw new Error(res.message || "Password change failed");
      clearPasswordFlag();
      await refreshAuth();
      toast({
        title: "Password updated",
        description: "Your password has been changed. You can now use the dashboard.",
        variant: "default",
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      toast({
        title: "Password change failed",
        description: err instanceof Error ? err.message : "Please try again",
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
          <div className="mx-auto w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mb-2">
            <AlertTriangle className="h-6 w-6 text-amber-600" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Set Your New Password</CardTitle>
          <CardDescription>
            {user?.username || "Your account"} must set a new password before continuing. This was
            required by an administrator or is your first sign-in.
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="current-password" className="text-sm font-medium text-foreground">
                Current Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="current-password"
                  type="password"
                  placeholder="Temporary or current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="pl-9"
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="new-password" className="text-sm font-medium text-foreground">
                New Password
              </label>
              <div className="relative">
                <ShieldCheck className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="new-password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pl-9"
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
                Confirm New Password
              </label>
              <div className="relative">
                <ShieldCheck className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-9"
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button className="w-full h-11 text-base font-medium" type="submit" disabled={isLoading}>
              {isLoading ? "Updating..." : "Update Password & Continue"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
