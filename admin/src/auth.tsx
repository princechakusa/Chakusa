import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { apiFetch, loginAdmin, logoutAdmin, onUnauthorized, refreshAdminSession, type AdminIdentity, type AdminUser } from "./api";

interface AuthState {
  status: "loading" | "authenticated" | "anonymous";
  user: AdminUser | null;
  admin: AdminIdentity | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);

  const clear = () => { setUser(null); setAdmin(null); setStatus("anonymous"); };

  useEffect(() => {
    const unsubscribe = onUnauthorized(clear);
    void (async () => {
      if (!await refreshAdminSession()) return clear();
      try {
        const me = await apiFetch<{ user: AdminUser; admin: AdminIdentity }>("/admin/auth/me");
        setUser(me.user); setAdmin(me.admin); setStatus("authenticated");
      } catch { clear(); }
    })();
    return unsubscribe;
  }, []);

  const value = useMemo<AuthState>(() => ({
    status,
    user,
    admin,
    login: async (email, password) => {
      const result = await loginAdmin(email, password);
      setUser(result.user); setAdmin(result.admin); setStatus("authenticated");
    },
    logout: async () => { await logoutAdmin(); clear(); },
    hasPermission: (permission) => admin?.permissions.includes(permission) ?? false,
  }), [status, user, admin]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
