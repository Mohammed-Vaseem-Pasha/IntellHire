import { useState, useEffect } from "react";
import { AlertCircle, ShieldCheck, ArrowRight } from "lucide-react";
import GlassBackground from "./GlassBackground";

/**
 * UnifiedGlassLogin
 *
 * Sign-in page that shares the same GlassBackground and light-glass
 * visual language as the authenticated workspace — one continuous design system.
 */
export default function CinematicLoginView({
  onLogin,
  authLoading = false,
  authError = "",
  BrandLogo,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  const handleSignIn = async () => {
    if (isSubmitting || authLoading) return;
    setIsSubmitting(true);
    try {
      await onLogin();
    } finally {
      setIsSubmitting(false);
    }
  };

  const busy = isSubmitting || authLoading;

  return (
    <div className={`ugl-root${mounted ? " ugl-mounted" : ""}`}>
      {/* Shared animated background — same component as authenticated shell */}
      <GlassBackground />

      {/* Central auth card — genuinely translucent */}
      <div className="ugl-card-wrap">
        <div className="ugl-card">
          {/* Top glass highlight */}
          <div className="ugl-card-highlight" aria-hidden="true" />

          {/* Brand */}
          <div className="ugl-brand">
            {BrandLogo ? (
              <BrandLogo />
            ) : (
              <div className="ugl-brand-default">
                <span className="ugl-brand-symbol">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <rect x="3"  y="3"  width="8" height="8" rx="2" fill="currentColor" />
                    <rect x="13" y="3"  width="8" height="8" rx="2" fill="currentColor" opacity=".45" />
                    <rect x="3"  y="13" width="8" height="8" rx="2" fill="currentColor" opacity=".45" />
                    <rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" />
                  </svg>
                </span>
                <span className="ugl-brand-text">
                  IntelliHire<span style={{ fontWeight: 400 }}>AI</span>
                </span>
              </div>
            )}
          </div>

          {/* Heading */}
          <div className="ugl-header">
            <h1 className="ugl-headline">Welcome back.</h1>
            <p className="ugl-subline">
              Sign in to access your career intelligence workspace.
            </p>
          </div>

          {/* Google Sign-In — real Firebase auth */}
          <button
            type="button"
            className="ugl-btn-google"
            onClick={handleSignIn}
            disabled={busy}
            aria-busy={busy}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span className="ugl-btn-label">
              {busy ? "Signing in…" : "Continue with Google"}
            </span>
            {!busy && <ArrowRight size={14} className="ugl-btn-arrow" />}
          </button>

          {/* Error */}
          {authError && (
            <div className="ugl-error" role="alert">
              <AlertCircle size={13} />
              <span>{authError}</span>
            </div>
          )}

          {/* Trust line */}
          <div className="ugl-trust">
            <ShieldCheck size={12} />
            <span>Secure · Free &amp; unlimited access</span>
          </div>

          {/* Capabilities */}
          <div className="ugl-caps">
            {["Resume Analysis", "Voice Interview", "Career Roadmap", "Feedback Reports"].map(
              (item) => (
                <span key={item} className="ugl-cap">
                  <span className="ugl-cap-dot" aria-hidden="true" />
                  {item}
                </span>
              )
            )}
          </div>
        </div>
      </div>

      <p className="ugl-footer">© 2026 IntelliHire AI</p>
    </div>
  );
}
