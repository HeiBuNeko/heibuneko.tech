import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-noto-sans-sc",
});

export const metadata: Metadata = {
  title: "HeiBuNekoTech",
  description: "Scientist working on creating NekoMusume",
};

const RootLayout = ({ children }: LayoutProps<"/">) => {
  return (
    <html lang="en" className={`${notoSansSC.variable} dark antialiased`}>
      <body className="bg-background text-foreground">{children}</body>
    </html>
  );
};

export default RootLayout;
