import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import PwaRegister from "@/components/editor/PwaRegister";

export const metadata: Metadata = {
  title: "PixelForge Studio — Free professional photo editor",
  description:
    "Professional-grade image editing that runs entirely in your browser. Layers, masks, filters, text, vectors — free, private, no account required. Your images never leave your device.",
  keywords: ["photo editor", "image editing", "layers", "filters", "free editor", "browser editor", "PixelForge"],
  authors: [{ name: "PixelForge Studio contributors" }],
  manifest: "/manifest.json",
  applicationName: "PixelForge Studio",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PixelForge Studio",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#17181c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground overflow-hidden overscroll-none">
        {children}
        <Toaster />
        <PwaRegister />
      </body>
    </html>
  );
}
