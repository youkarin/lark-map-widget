import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lark Bitable Map Widget",
  description: "Feishu dashboard widget: visualize Bitable records on a Leaflet map",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Script
          src="https://lf3-static.bytednsdoc.com/obj/bitable-static/feishu-bitable-js-sdk/bitable.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}
