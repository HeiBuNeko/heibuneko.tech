import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import { SWRConfig, type SWRConfiguration } from "swr";

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-noto-sans-sc",
});

export const metadata: Metadata = {
  title: "HeiBuNekoTech",
  description: "Scientist working on creating NekoMusume",
};

const swrConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  keepPreviousData: true,
};

const RootLayout = ({ children }: LayoutProps<"/">) => {
  return (
    <html lang="en" className={`${notoSansSC.variable} dark antialiased`}>
      <body className="bg-background text-foreground">
        <SWRConfig value={swrConfig}>{children}</SWRConfig>
        <Script
          src="https://umami.heibuneko.tech/script.js"
          data-website-id="5fd2c529-3e22-47b4-a8c5-4e9bca3e7d49"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
};

export default RootLayout;
