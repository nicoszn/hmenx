import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HMEM — Memory Sandbox",
  description: "Interactive hierarchical memory sandbox for multi-agent LLM sessions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
