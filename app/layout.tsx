import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Real-Time Dictation Tester — AssemblyAI",
  description:
    "A tester for real-time dictation into structured, templated reports with Universal-3.5 Pro Streaming.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
