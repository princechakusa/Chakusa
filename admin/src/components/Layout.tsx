import {
  Activity, BarChart3, Building2, ChevronDown, CircleHelp, CreditCard, FileClock, LayoutDashboard,
  LogOut, Menu, MessageSquareText, Moon, Scale, Search, Settings, ShieldCheck, Sun, Users, Workflow, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

const navigation = [
  { to: "/", label: "Overview", icon: LayoutDashboard, permission: "platform.read" },
  { to: "/analytics", label: "Analytics", icon: BarChart3, permission: "platform.read" },
  { to: "/businesses", label: "Businesses", icon: Building2, permission: "business.read" },
  { to: "/users", label: "Users", icon: Users, permission: "user.read" },
  { to: "/subscriptions", label: "Subscriptions", icon: CreditCard, permission: "subscription.read" },
  { to: "/automation", label: "Automation", icon: Workflow, permission: "automation.read" },
  { to: "/communications", label: "Communications", icon: MessageSquareText, permission: "communication.read" },
  { to: "/support", label: "Support", icon: CircleHelp, permission: "support.read" },
  { to: "/feedback", label: "Beta feedback", icon: MessageSquareText, permission: "feedback.read" },
  { to: "/audit", label: "Audit log", icon: FileClock, permission: "audit.read" },
  { to: "/legal", label: "Legal", icon: Scale, permission: "legal.read" },
  { to: "/security", label: "Security", icon: ShieldCheck, permission: null },
  { to: "/settings", label: "Settings", icon: Settings, permission: "settings.read" },
];

export default function Layout() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("chakusa_admin_theme") ?? "light");

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("chakusa_admin_theme", theme); }, [theme]);
  useEffect(() => { setMenuOpen(false); setProfileOpen(false); }, [location.pathname]);
  const visibleNavigation = useMemo(() => navigation.filter((item) => !item.permission || auth.hasPermission(item.permission)), [auth.admin]);

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><span /></div><div><strong>CHAKUSA</strong><small>Administration</small></div><button className="mobile-close" onClick={() => setMenuOpen(false)}><X size={20} /></button></div>
      <nav aria-label="Primary navigation">
        <p>Workspace</p>
        {visibleNavigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/"}><Icon size={18} /><span>{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-foot"><div className="security-note"><ShieldCheck size={18} /><div><strong>Secure workspace</strong><span>All actions are audited</span></div></div><div className="environment"><i />Local test environment</div></div>
    </aside>
    {menuOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <div className="main-column">
      <header className="topbar">
        <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
        <button className="command-search" onClick={() => navigate("/businesses")}><Search size={16} /><span>Search businesses, users, or customers</span><kbd>/</kbd></button>
        <div className="topbar-actions">
          <button className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle color theme">{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <div className="profile-menu"><button onClick={() => setProfileOpen(!profileOpen)}><span className="avatar">{auth.user?.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span className="profile-copy"><strong>{auth.user?.fullName}</strong><small>{auth.admin?.role.replaceAll("_", " ")}</small></span><ChevronDown size={14} /></button>{profileOpen && <div className="profile-popover"><div><strong>{auth.user?.fullName}</strong><span>{auth.user?.email}</span></div><button onClick={() => void auth.logout()}><LogOut size={16} />Secure logout</button></div>}</div>
        </div>
      </header>
      <main><Outlet /></main>
    </div>
  </div>;
}
