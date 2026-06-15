import type { ReactNode } from "react";

export default function Panel({
  index,
  title,
  meta,
  children,
  className = "",
  delay = 0,
}: {
  index: string;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    // no entrance animation: these boxes always arrive after the loading
    // skeleton already drew them, and re-rising read as a full repaint.
    // the boxes stay put; only their CONTENT animates in.
    <section className={`hud flex flex-col ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <header className="flex items-baseline justify-between gap-3 border-b border-grid px-4 py-2.5 sm:px-5">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="module-index shrink-0">{index} /</span>
          <h2 className="module-title truncate">{title}</h2>
        </div>
        {meta ? <div className="numeral hidden shrink-0 text-label text-dim sm:block">{meta}</div> : null}
      </header>
      <div className="min-h-0 flex-1 px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}
