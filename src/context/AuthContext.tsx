import React, { createContext, useContext, useState, useEffect } from "react";
import { checkAuth, logout, CurrentUser } from "@/lib/api";

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
  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading");
  const [user, setUser] = useState<CurrentUser | null>(null);

  const refreshAuth = async () => {
    try {
      const res = await checkAuth();
      if (res.authenticated && res.user) {
        setUser(res.user);
        setStatus("authenticated");
        return true;
      }
      setUser(null);
      setStatus("unauthenticated");
      return false;
    } catch {
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
