import React, { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { 
  LogOut, 
  Home, 
  Users, 
  Users2,
  History, 
  FileText, 
  Menu, 
  X, 
  Plus,
  Shield,
  Briefcase,
  Settings,
  UserCircle,
  CloudOff
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { flushPending, subscribePending, type PendingServe } from "@/lib/offlineQueue";
import { api } from "@/lib/api";

export function Header() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user, isAdmin, isServer, signOut } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    return subscribePending((items: PendingServe[]) => setPendingCount(items.length));
  }, []);

  const handleFlush = async () => {
    const result = await flushPending((payload) =>
      api.createServeAttempt({ ...payload, _offlineReplay: true })
    );
    if (result.ok) {
      toast({ title: "Synced", description: `${result.ok} pending attempt${result.ok === 1 ? "" : "s"} uploaded.` });
    } else if (result.fail) {
      toast({ title: "Still offline", description: "Could not upload pending attempts yet.", variant: "destructive" });
    }
  };

  const handleLogout = async () => {
    await signOut();
    toast({
      title: "Logged out",
      description: "You have been logged out successfully",
      variant: "default"
    });
    navigate('/login');
  };

  const mobileNavLink = ({ isActive }: { isActive: boolean }) => 
    cn(
      "flex items-center gap-2 py-3 px-4 rounded-md transition-colors w-full",
      isActive 
        ? "bg-primary/10 text-primary" 
        : "text-muted-foreground hover:bg-accent hover:text-foreground"
    );
  
  const desktopNavLink = ({ isActive }: { isActive: boolean }) => 
    cn(
      "text-sm font-medium transition-colors hover:text-primary flex items-center gap-1",
      isActive ? "text-foreground" : "text-muted-foreground"
    );

  // Mobile menu content
  const mobileMenu = (
    <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden min-h-11 min-w-11 h-11 w-11">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[75vw] max-w-[300px] p-0">
        <div className="flex flex-col h-full">
          <div className="border-b p-4 flex items-center justify-between">
            <div>
              <Link to="/dashboard" className="font-bold text-lg flex items-center gap-2" onClick={() => setIsMenuOpen(false)}>
                <img src="/logo.webp" alt="JLS Logo" className="h-6 w-auto object-contain rounded" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                <span>ServeTracker</span>
              </Link>
              {user && (
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  {isAdmin ? <Shield className="h-3 w-3 text-primary" /> : <Briefcase className="h-3 w-3 text-blue-600" />}
                  <span>{user.displayName || user.username}</span>
                  {user.username && (
                    <span className="font-mono">@{user.username}</span>
                  )}
                  <span className="text-[10px] uppercase font-semibold px-1 py-0.2 bg-muted rounded">
                    {user.role}
                  </span>
                </div>
              )}
            </div>
          </div>
          <nav className="flex-1 p-2 space-y-1">
            <NavLink to="/dashboard" className={mobileNavLink} onClick={() => setIsMenuOpen(false)}>
              <Home className="h-5 w-5" />
              {isServer ? "My Assigned Cases" : "Dashboard"}
            </NavLink>
            <NavLink to="/new-serve" className={mobileNavLink} onClick={() => setIsMenuOpen(false)}>
              <Plus className="h-5 w-5" />
              New Attempt
            </NavLink>
            {pendingCount > 0 && (
              <button
                type="button"
                className={mobileNavLink({ isActive: false })}
                onClick={() => {
                  setIsMenuOpen(false);
                  void handleFlush();
                }}
              >
                <CloudOff className="h-5 w-5 text-amber-600" />
                Pending sync ({pendingCount})
              </button>
            )}
            {isAdmin && (
              <NavLink to="/clients" className={mobileNavLink} onClick={() => setIsMenuOpen(false)}>
                <Users className="h-5 w-5" />
                Clients
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/servers" className={mobileNavLink} onClick={() => setIsMenuOpen(false)}>
                <Users2 className="h-5 w-5" />
                Servers
              </NavLink>
            )}
            <NavLink to="/history" className={mobileNavLink} onClick={() => setIsMenuOpen(false)}>
              <History className="h-5 w-5" />
              History
            </NavLink>
            {isAdmin && (
              <NavLink to="/export" className={mobileNavLink} onClick={() => setIsMenuOpen(false)}>
                <FileText className="h-5 w-5" />
                Export
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/settings" className={mobileNavLink} onClick={() => setIsMenuOpen(false)}>
                <Settings className="h-5 w-5" />
                Settings
              </NavLink>
            )}
            <NavLink to="/profile" className={mobileNavLink} onClick={() => setIsMenuOpen(false)}>
              <UserCircle className="h-5 w-5" />
              My Profile
            </NavLink>
          </nav>
          <div className="border-t p-4">
            <Button 
              variant="ghost" 
              size="sm" 
              className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50" 
              onClick={() => {
                handleLogout();
                setIsMenuOpen(false);
              }}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background shadow-xs">
      <div className="flex h-14 items-center px-4">
        {isMobile ? (
          <>
            {mobileMenu}
            <div className="flex-1 flex flex-col items-center justify-center">
              <Link to="/dashboard" className="font-bold text-base leading-tight">
                ServeTracker
              </Link>
              {user && (
                <span className="text-[11px] text-muted-foreground leading-tight">
                  {user.displayName || user.username} @{user.username} ({user.role})
                </span>
              )}
            </div>
            <Button 
              variant="default" 
              size="sm" 
              onClick={() => navigate('/new-serve')}
              className="flex items-center rounded-full min-h-10 h-10 px-3"
            >
              <Plus className="h-4 w-4" />
              <span className="ml-1 hidden sm:inline">Attempt</span>
            </Button>
          </>
        ) : (
          <>
            <div className="mr-6 flex items-center gap-2">
              <Link to="/dashboard" className="font-bold text-lg flex items-center gap-2">
                <img src="/logo.webp" alt="JLS Logo" className="h-6 w-auto object-contain rounded" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                <span>ServeTracker</span>
              </Link>
              {user && (
                <span className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1",
                  isAdmin ? "bg-primary/10 text-primary" : "bg-blue-100 text-blue-800"
                )}>
                  {isAdmin ? <Shield className="h-3 w-3" /> : <Briefcase className="h-3 w-3" />}
                  {user.displayName || user.username}
                  {user.username ? ` @${user.username}` : ""}
                </span>
              )}
            </div>
            <nav className="flex flex-1 items-center space-x-4">
              <NavLink
                to="/dashboard"
                className={desktopNavLink}
              >
                <Home className="h-4 w-4" />
                {isServer ? "My Assigned Cases" : "Dashboard"}
              </NavLink>
              {isAdmin && (
                <NavLink
                  to="/clients"
                  className={desktopNavLink}
                >
                  <Users className="h-4 w-4" />
                  Clients
                </NavLink>
              )}
              {isAdmin && (
                <NavLink
                  to="/servers"
                  className={desktopNavLink}
                >
                  <Users2 className="h-4 w-4" />
                  Servers
                </NavLink>
              )}
              <NavLink
                to="/history"
                className={desktopNavLink}
              >
                <History className="h-4 w-4" />
                History
              </NavLink>
              {isAdmin && (
                <NavLink
                  to="/export"
                  className={desktopNavLink}
                >
                  <FileText className="h-4 w-4" />
                  Export
                </NavLink>
              )}
              {isAdmin && (
                <NavLink
                  to="/settings"
                  className={desktopNavLink}
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </NavLink>
              )}
              <NavLink
                to="/profile"
                className={desktopNavLink}
              >
                <UserCircle className="h-4 w-4" />
                My Profile
              </NavLink>
            </nav>
            <div className="ml-auto flex items-center space-x-2">
              {pendingCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFlush}
                  className="flex items-center text-amber-700 border-amber-300"
                >
                  <CloudOff className="h-4 w-4 mr-1" />
                  Pending {pendingCount}
                </Button>
              )}
              <Button 
                variant="default" 
                size="sm" 
                onClick={() => navigate('/new-serve')}
                className="flex items-center"
              >
                <Plus className="h-4 w-4 mr-1" /> New Attempt
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4 mr-1" />
                Logout
              </Button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
