import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI Commerce Copilot",
  description: "Grounded shopping conversations",
};

type RootLayoutProperties = {
  children: ReactNode;
};

export default function RootLayout({
  children,
}: RootLayoutProperties): ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
