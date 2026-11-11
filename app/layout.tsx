import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";
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
      </body>
    </html>
  );
};

export default RootLayout;
