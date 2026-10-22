import {
  ChartNoAxesCombined,
  FileUser,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Route,
  Sliders,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { id: "dashboard", label: "Overview", Icon: LayoutDashboard },
  { id: "resume",    label: "Resume",   Icon: FileUser },
  { id: "interview", label: "Interview",Icon: MessagesSquare },
  { id: "feedback",  label: "Feedback", Icon: ChartNoAxesCombined },
  { id: "roadmap",   label: "Roadmap",  Icon: Route },
  { id: "settings",  label: "Settings", Icon: Sliders },
];

export default function GlassTopNav({
  user,
  page,
  changePage,
  handleLogout,
  mobileOpen,
  setMobileOpen,
}) {
  const firstName = user?.displayName?.split(" ")[0] || "Candidate";

  return (
    <nav className="glass-topnav" aria-label="Main navigation">
      {/* Brand */}
      <button
        className="glass-topnav-brand"
        onClick={() => changePage("dashboard")}
        type="button"
        aria-label="Go to overview"
      >
        <span className="glass-topnav-brand-symbol">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect x="3"  y="3"  width="8" height="8" rx="2" fill="currentColor" />
            <rect x="13" y="3"  width="8" height="8" rx="2" fill="currentColor" opacity=".45" />
            <rect x="3"  y="13" width="8" height="8" rx="2" fill="currentColor" opacity=".45" />
            <rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" />
          </svg>
        </span>
        <span className="glass-topnav-brand-text">
          IntelliHire<span style={{ fontWeight: 400 }}>AI</span>
        </span>
      </button>

      {/* Desktop nav links */}
      <div className="glass-topnav-links" role="menubar">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="menuitem"
            className={`glass-nav-pill ${page === id ? "glass-nav-pill-active" : ""}`}
            onClick={() => changePage(id)}
            aria-current={page === id ? "page" : undefined}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Right cluster */}
      <div className="glass-topnav-right">
        {/* System status */}
        <span className="glass-topnav-status" aria-live="polite">
          <span className="status-dot-active" aria-hidden="true" />
          <span className="glass-topnav-status-label">Online</span>
        </span>

        {/* Avatar */}
        {user?.photoURL ? (
          <img
            src={user.photoURL}
            alt={user.displayName || "User"}
            className="glass-topnav-avatar"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="glass-topnav-avatar glass-topnav-avatar-fallback">
            {firstName.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Logout — desktop */}
        <button
          className="glass-topnav-logout"
          onClick={handleLogout}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut size={16} aria-hidden="true" />
        </button>

        {/* Hamburger — mobile */}
        <button
          className="glass-topnav-hamburger"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="glass-mobile-menu" role="dialog" aria-label="Mobile navigation">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`glass-mobile-item ${page === id ? "glass-mobile-item-active" : ""}`}
              onClick={() => { changePage(id); setMobileOpen(false); }}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
          <div className="glass-mobile-divider" />
          <button className="glass-mobile-item glass-mobile-logout" onClick={handleLogout}>
            <LogOut size={17} aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </nav>
  );
}
