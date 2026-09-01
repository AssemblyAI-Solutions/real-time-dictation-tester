import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Real-Time Dictation Bench — AssemblyAI",
  description:
    "Side-by-side bench for Universal-3.5 Pro Streaming and the Dictation API in a structured reporting workflow.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
