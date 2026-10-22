/**
 * GlassBackground
 *
 * Fixed full-screen animated background shared by BOTH the login page
 * and the authenticated workspace — one continuous visual environment.
 *
 * Uses GPU-composited CSS animations with layered luminous color fields
 * (cool blue, lavender, cyan, and subtle pink highlights) and drifting light streaks.
 * Respects prefers-reduced-motion.
 */
export default function GlassBackground() {
  return (
    <div className="glass-bg-root" aria-hidden="true">
      <div className="glass-bg-blob glass-bg-blob-1" />
      <div className="glass-bg-blob glass-bg-blob-2" />
      <div className="glass-bg-blob glass-bg-blob-3" />
      <div className="glass-bg-blob glass-bg-blob-4" />
      <div className="glass-bg-blob glass-bg-blob-5" />
      <div className="glass-bg-streak glass-bg-streak-1" />
      <div className="glass-bg-streak glass-bg-streak-2" />
    </div>
  );
}
