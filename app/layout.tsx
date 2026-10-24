import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pearson Market | The Bahamas Trading Game",
  description: "A fictional Bahamian market game with shared liquidity, interactive charts, and virtual spot and leveraged futures trading.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
