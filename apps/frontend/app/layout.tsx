import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const pretendard = localFont({
  src: "../public/font/PretendardVariable.woff2",
  display: "swap",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "Liar Game Web",
  description: "Enjoy Liar Game on web!",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${pretendard.variable} antialiased w-dvw min-h-dvh`}>{children}</body>
    </html>
  );
}
