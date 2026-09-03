import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  UserPlus, Users, Shield, Briefcase, RefreshCw, ChevronRight, Trash2,
  Search, Phone, MessageSquare, Mail, MapPin, DollarSign,
} from "lucide-react";
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
  email?: string;
  phone?: string;
  legalName?: string;
  licenseNumber?: string;
  licenseJurisdiction?: string;
  licenseExpiresAt?: string;
  licenseStatus?: "valid" | "expires_soon" | "expired" | "missing" | "n/a";
  serviceTerritory?: string[];
  profileNotes?: string;
  signatureStatus?: { enrolled: boolean; revoked: boolean; updatedAt?: string };
  onboardingStatus?: string;
  activeCaseCount?: number;
  lastActivityAt?: string;
  mustChangePassword?: boolean;
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDeactivated, setShowDeactivated] = useState(false);
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
    if (!confirm(`Remove "${user.displayName}"? If they have signed affidavits they will be deactivated instead of deleted.`)) return;
    try {
      const result = await api.deleteUser(user.id);
      if (result?.deactivated) {
        toast({
          title: "Moved to deactivated",
          description: "Server has signed affidavits and has been moved to deactivated status",
        });
      } else {
        toast({ title: "User deleted", description: `User "${user.displayName}" removed` });
      }
      fetchUsers();
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete user", variant: "destructive" });
    }
  };

  // Real-time server search filtering by name, phone, license, or county territory
  const q = searchQuery.toLowerCase().trim();
  const deactivatedCount = users.filter((u) => u.isActive === false).length;
  const filteredUsers = users.filter((u) => {
    if (!showDeactivated && u.isActive === false) return false;
    if (!q) return true;
    const nameMatch = (u.displayName || "").toLowerCase().includes(q) || (u.username || "").toLowerCase().includes(q) || (u.legalName || "").toLowerCase().includes(q);
    const phoneMatch = (u.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, ""));
    const emailMatch = (u.email || "").toLowerCase().includes(q);
    const licenseMatch = (u.licenseNumber || "").toLowerCase().includes(q) || (u.licenseJurisdiction || "").toLowerCase().includes(q);
    const territoryMatch = Array.isArray(u.serviceTerritory) && u.serviceTerritory.some((t) => t.toLowerCase().includes(q));
    const notesMatch = (u.profileNotes || "").toLowerCase().includes(q);
    return nameMatch || phoneMatch || emailMatch || licenseMatch || territoryMatch || notesMatch;
  });

  return (
    <Card className="w-full shadow-xs border-slate-200">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
            <Users className="h-5 w-5 text-primary shrink-0" /> Field Servers & User Management
          </CardTitle>
          <CardDescription>
            Find, contact, and manage field process servers, coverage territory, and rates.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={fetchUsers} disabled={isLoading} className="h-9 w-9 p-0">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            <span className="sr-only">Refresh</span>
          </Button>
          <Button size="sm" className="flex items-center gap-1.5 h-9 bg-blue-600 hover:bg-blue-700" onClick={() => setIsIntakeOpen(true)}>
            <UserPlus className="h-4 w-4" /> Add Field Server
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Search Bar for Counties, Names, Licenses, Phone */}
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-3 text-slate-400" />
          <Input
            placeholder="Search by county / territory (e.g. Rogers, Tulsa), server name, phone, or PSL #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-10 text-sm bg-slate-50/50"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchQuery("")}
              className="absolute right-1 top-1 h-8 text-xs text-slate-500"
            >
              Clear
            </Button>
          )}
        </div>
        {deactivatedCount > 0 && (
          <Button
            type="button"
            variant={showDeactivated ? "secondary" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setShowDeactivated((v) => !v)}
          >
            {showDeactivated ? "Hide deactivated" : `Show deactivated (${deactivatedCount})`}
          </Button>
        )}

        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading accounts...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {searchQuery ? `No servers found matching "${searchQuery}".` : 'No server accounts configured yet.'}
          </div>
        ) : (
          <div className="divide-y rounded-md border border-slate-200">
            {filteredUsers.map((u) => (
              <div key={u.id} className="p-3 sm:p-4 flex flex-col gap-3 bg-white hover:bg-slate-50/50 transition">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-700 shrink-0 mt-0.5">
                      {u.role === "admin" ? <Shield className="h-5 w-5 text-primary" /> : <Briefcase className="h-5 w-5 text-blue-600" />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-base text-slate-900">{u.displayName}</span>
                        <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 uppercase font-semibold">
                          {u.role}
                        </Badge>
                        {!u.isActive && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Inactive</Badge>}
                        {u.onboardingStatus && u.onboardingStatus !== "active" && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{u.onboardingStatus}</Badge>
                        )}
                        {u.licenseNumber && (
                          <span className="text-[11px] font-mono font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                            {u.licenseNumber}
                          </span>
                        )}
                        {u.licenseStatus === "expired" && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">License expired</Badge>
                        )}
                        {u.licenseStatus === "expires_soon" && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-amber-700 bg-amber-50">License expiring</Badge>
                        )}
                      </div>

                      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3">
                        <span>@{u.username}</span>
                        {u.licenseJurisdiction && <span>• {u.licenseJurisdiction}</span>}
                        {u.role === "server" && u.activeCaseCount !== undefined && (
                          <span className="font-semibold text-blue-600">• {u.activeCaseCount} active case{u.activeCaseCount === 1 ? "" : "s"}</span>
                        )}
                      </div>

                      {/* Covered Territory Badges */}
                      {Array.isArray(u.serviceTerritory) && u.serviceTerritory.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          <MapPin className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span className="text-[11px] font-bold text-slate-600">Territory:</span>
                          {u.serviceTerritory.map((t, idx) => (
                            <span key={idx} className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-medium">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Rates & Pricing Notes Display */}
                      {u.profileNotes && (
                        <div className="text-xs bg-slate-50 border border-slate-100 rounded-md p-2 mt-1.5 text-slate-700 whitespace-pre-line font-mono text-[11px]">
                          {u.profileNotes}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions & Direct Call/Text Buttons */}
                  <div className="flex items-center gap-2 flex-wrap shrink-0 self-end sm:self-start">
                    {u.phone && (
                      <>
                        <a
                          href={`tel:${u.phone}`}
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 transition shadow-2xs"
                          title={`Call ${u.displayName}`}
                        >
                          <Phone className="h-3.5 w-3.5" /> Call
                        </a>
                        <a
                          href={`sms:${u.phone}`}
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-300 hover:bg-blue-100 transition shadow-2xs"
                          title={`Text / SMS ${u.displayName}`}
                        >
                          <MessageSquare className="h-3.5 w-3.5" /> Text
                        </a>
                      </>
                    )}
                    {u.email && (
                      <a
                        href={`mailto:${u.email}`}
                        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-300 hover:bg-slate-100 transition"
                        title={`Email ${u.displayName}`}
                      >
                        <Mail className="h-3.5 w-3.5" /> Email
                      </a>
                    )}

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
