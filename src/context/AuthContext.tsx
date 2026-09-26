import React, { createContext, useContext, useState, useEffect } from "react";
import { checkAuth, logout, CurrentUser } from "@/lib/api";

const AUTH_CACHE_KEY = "servetracker_auth_user";

interface AuthContextType {
  status: "loading" | "authenticated" | "unauthenticated";
  user: CurrentUser | null;
  isAdmin: boolean;
  isServer: boolean;
  mustChangePassword: boolean;
  refreshAuth: () => Promise<boolean>;
  signOut: () => Promise<void>;
  clearPasswordFlag: () => void;
}

const AuthContext = createContext<AuthContextType>({
  status: "loading",
  user: null,
  isAdmin: false,
  isServer: false,
  mustChangePassword: false,
  refreshAuth: async () => false,
  signOut: async () => {},
  clearPasswordFlag: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<CurrentUser | null>(() => {
    try {
      const saved = localStorage.getItem(AUTH_CACHE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">(() => {
    try {
      const saved = localStorage.getItem(AUTH_CACHE_KEY);
      return saved ? "authenticated" : "loading";
    } catch {
      return "loading";
    }
  });

  const refreshAuth = async () => {
    try {
      const res = await checkAuth();
      if (res.authenticated && res.user) {
        setUser(res.user);
        setStatus("authenticated");
        try {
          localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(res.user));
        } catch {}
        return true;
      }
      // Explicit unauthenticated from server
      localStorage.removeItem(AUTH_CACHE_KEY);
      setUser(null);
      setStatus("unauthenticated");
      return false;
    } catch (err) {
      // Network failure / offline: preserve active user session
      const cached = localStorage.getItem(AUTH_CACHE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setUser(parsed);
          setStatus("authenticated");
          return true;
        } catch {}
      }
      setUser(null);
      setStatus("unauthenticated");
      return false;
    }
  };

  useEffect(() => {
    refreshAuth();
  }, []);

  const signOut = async () => {
    try {
      await logout();
    } catch {
      // Ignore network errors on logout
    }
    localStorage.removeItem(AUTH_CACHE_KEY);
    setUser(null);
    setStatus("unauthenticated");
  };

  const isAdmin = user ? user.role === "admin" : false;
  const isServer = user?.role === "server";
  const mustChangePassword = !!user?.mustChangePassword;

  const clearPasswordFlag = () => {
    setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
  };

  return (
    <AuthContext.Provider value={{ status, user, isAdmin, isServer, mustChangePassword, refreshAuth, signOut, clearPasswordFlag }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
