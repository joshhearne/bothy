import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Strata",
  description: "Self-hosted structured IT documentation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
