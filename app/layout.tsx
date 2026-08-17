import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MasterDash",
  description: "Tile-based personal operating system portal",
  appleWebApp: {
    capable: true,
    title: "MasterDash",
    // Black-translucent lets the page paint under the status bar, which is
    // what makes the top frame read as bezel once installed.
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  // A tile grid has nothing to zoom into, and pinch-zoom in the field is
  // almost always an accident.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
