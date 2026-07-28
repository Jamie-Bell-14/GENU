import type { Metadata } from "next";
import { APPEARANCE_INIT_SCRIPT } from "@/lib/appearance/appearance";
import { AppearanceProvider } from "@/lib/appearance/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intelligent Product Lab",
  description:
    "An AI-guided environment for moving from an uncertain idea to an evidence-backed product plan.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // data-* appearance attributes are stamped pre-hydration by the inline
    // script below, so the server-rendered values differ intentionally.
    <html
      lang="en"
      data-theme="dark"
      data-density="comfortable"
      data-text-size="default"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <AppearanceProvider>{children}</AppearanceProvider>
      </body>
    </html>
  );
}
