import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dream Journey",
  description: "An immersive experience, exploring interactive AI generated artwork",
  keywords: ["AI", "Midjourney", "dreams", "art", "generative art", "interactive", "zoom"],
  authors: [{ name: "Poobesh Gowtham" }],
  creator: "Poobesh Gowtham",
  publisher: "Poobesh Gowtham",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL("https://dreamjourney.app"),
  openGraph: {
    title: "Dream Journey",
    description: "An immersive experience, exploring interactive AI generated artwork",
    type: "website",
    locale: "en_US",
    siteName: "Dream Journey",
    images: [
      {
        url: "/dream-journey-og.png",
        width: 1200,
        height: 630,
        alt: "Dream Journey - An immersive experience, exploring interactive AI generated artwork",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dream Journey",
    description: "An immersive experience, exploring interactive AI generated artwork",
    creator: "@pbshgthm",
    site: "@pbshgthm",
    images: [
      {
        url: "/dream-journey-og.png",
        width: 1200,
        height: 630,
        alt: "Dream Journey - An immersive experience, exploring interactive AI generated artwork",
      },
    ],
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black">{children}</body>
    </html>
  );
}
