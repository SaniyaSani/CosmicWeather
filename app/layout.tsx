import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Invisible Weather · Cosmic Rain & Breathing Buildings",
  description: "An open citizen-science instrument: calibrate a particle detector, inspect every pulse, and read it against atmosphere, Jungfraujoch and space weather.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

const FONTS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@300;400;500&display=swap";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
