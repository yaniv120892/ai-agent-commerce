import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

import "./globals.css";

const inter = Inter({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-sans",
});

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
    <html className={inter.variable} lang="en">
      <body>{children}</body>
    </html>
  );
}
