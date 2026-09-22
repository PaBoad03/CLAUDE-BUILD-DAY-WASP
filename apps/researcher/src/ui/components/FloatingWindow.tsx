import type { CSSProperties, ReactNode } from "react";

export interface FloatingWindowProps {
  title: string;
  accent?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  /** Small text at the right of the title bar. */
  meta?: string;
}

/** CRT-styled floating panel. Candidate for `packages/ui`. */
export function FloatingWindow({ title, accent, className = "", style, children, meta }: FloatingWindowProps) {
  return (
    <section className={`win ${className}`} style={{ ...(accent ? { ["--accent" as string]: accent } : {}), ...style }}>
      <header className="win__bar">
        <span className="win__dot" />
        <span className="win__title">{title}</span>
        {meta && <span className="win__meta">{meta}</span>}
      </header>
      <div className="win__body">{children}</div>
    </section>
  );
}
