"use client";

import Link from "next/link";

// Last-resort boundary: it replaces the root layout when the layout itself
// throws, so it brings its own <html>, <body> and colors (the dark palette of
// globals.css, inlined; no fonts). Like the explorer's boundary, it shows the
// digest that keys the server's "request.failed" log line instead of guessing
// a cause.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#020509",
          color: "#d9e8f5",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        <title>Warpchart · signal lost</title>
        <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 16px" }}>
          <p style={{ letterSpacing: "0.3em", color: "#f2a33c", margin: 0 }}>SIGNAL LOST</p>
          <p style={{ lineHeight: 1.6, color: "#8aa3ba" }}>
            This page failed on the server. Nothing is broken on your side, and a retry often
            gets through.
          </p>
          {error.digest && (
            <p style={{ letterSpacing: "0.2em", color: "#8aa3ba" }}>
              REF <span style={{ color: "#d9e8f5", userSelect: "all" }}>{error.digest}</span>
            </p>
          )}
          <p style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => unstable_retry()}
              style={{
                font: "inherit",
                letterSpacing: "0.2em",
                padding: "8px 16px",
                background: "transparent",
                color: "#53d6e8",
                border: "1px solid #53d6e866",
                cursor: "pointer",
              }}
            >
              ▶ RETRY
            </button>
            <Link
              href="/"
              style={{
                letterSpacing: "0.2em",
                padding: "8px 16px",
                color: "#8aa3ba",
                border: "1px solid #11263b",
                textDecoration: "none",
              }}
            >
              RETURN TO BASE
            </Link>
          </p>
        </main>
      </body>
    </html>
  );
}
