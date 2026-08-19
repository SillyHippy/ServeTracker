import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Users, Shield, Briefcase, RefreshCw, ChevronRight, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import ServerIntakeDialog from "@/components/ServerIntakeDialog";
import ServerProfileDialog from "@/components/ServerProfileDialog";
import SignatureStatusBadge from "@/components/SignatureStatusBadge";

interface UserItem {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "server";
  isActive: boolean;
  createdAt: string;
  legalName?: string;
  licenseStatus?: "valid" | "expires_soon" | "expired" | "missing" | "n/a";
  signatureStatus?: { enrolled: boolean; revoked: boolean; updatedAt?: string };
  onboardingStatus?: string;
  activeCaseCount?: number;
  lastActivityAt?: string;
  mustChangePassword?: boolean;
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isIntakeOpen, setIsIntakeOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const { user: authUser } = useAuth();
  const { toast } = useToast();

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const data = await api.getUsers();
      if (Array.isArray(data)) {
        setUsers(data as unknown as UserItem[]);
      }
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDeleteUser = async (user: UserItem) => {
    if (user.id === "usr_admin_default" || user.username === "admin") {
      toast({ title: "Action blocked", description: "Cannot delete primary administrator", variant: "destructive" });
      return;
    }
    if (!confirm(`Delete user "${user.displayName}"? Assigned cases will be unassigned and all sessions revoked.`)) return;
    try {
      await api.deleteUser(user.id);
      toast({ title: "User deleted", description: `User "${user.displayName}" removed`, variant: "default" });
      fetchUsers();
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete user", variant: "destructive" });
    }
  };

  return (
    <Card className="w-full shadow-xs border-slate-200">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Field Servers & User Management
          </CardTitle>
          <CardDescription>
            Onboard field process servers with profiles, credentials, and account management.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchUsers} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" className="flex items-center gap-1" onClick={() => setIsIntakeOpen(true)}>
            <UserPlus className="h-4 w-4" /> Add Field Server
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading accounts...</div>
        ) : users.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No server accounts configured yet. Click "Add Field Server" to onboard one.
          </div>
        ) : (
          <div className="divide-y rounded-md border border-slate-100">
            {users.map((u) => (
              <div key={u.id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
                <button
                  type="button"
                  className="flex items-center gap-3 text-left flex-1 min-w-0 hover:bg-slate-50 rounded-lg p-1 -m-1"
                  onClick={() => setProfileUserId(u.id)}
                >
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
                    {u.role === "admin" ? <Shield className="h-4 w-4 text-primary" /> : <Briefcase className="h-4 w-4 text-blue-600" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-900 truncate">{u.displayName}</span>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 uppercase">
                        {u.role}
                      </Badge>
                      {!u.isActive && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Inactive</Badge>}
                      {u.onboardingStatus && u.onboardingStatus !== "active" && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{u.onboardingStatus}</Badge>
                      )}
                      {u.mustChangePassword && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-700 border-amber-300">Must set password</Badge>
                      )}
                      {u.licenseStatus === "expired" && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">License expired</Badge>
                      )}
                      {u.licenseStatus === "expires_soon" && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-amber-700">License expiring</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2">
                      <span>Username: <code className="text-slate-800 bg-slate-100 px-1 py-0.5 rounded">{u.username}</code></span>
                      {u.role === "server" && u.activeCaseCount !== undefined && (
                        <span>{u.activeCaseCount} active case{u.activeCaseCount === 1 ? "" : "s"}</span>
                      )}
                      {u.lastActivityAt && (
                        <span className="text-[11px] text-slate-400">Last activity {new Date(u.lastActivityAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  {u.role === "server" && u.signatureStatus && (
                    <SignatureStatusBadge
                      enrolled={!!u.signatureStatus.enrolled}
                      revoked={!!u.signatureStatus.revoked}
                      updatedAt={u.signatureStatus.updatedAt}
                    />
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setProfileUserId(u.id)}
                  >
                    Profile <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                  {u.id !== "usr_admin_default" && u.username !== "admin" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleDeleteUser(u)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <ServerIntakeDialog open={isIntakeOpen} onOpenChange={setIsIntakeOpen} onCreated={fetchUsers} />
      {profileUserId && (
        <ServerProfileDialog
          userId={profileUserId}
          open={!!profileUserId}
          onOpenChange={(o) => { if (!o) setProfileUserId(null); }}
          onChanged={fetchUsers}
          isSelf={profileUserId === authUser?.id}
        />
      )}
    </Card>
  );
}
