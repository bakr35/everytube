import type { Metadata } from "next";
import { Archivo_Black, Inter_Tight, IBM_Plex_Sans_Arabic, Amiri } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const archivoBlack = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-archivo",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
});

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  weight: ["400", "500", "600"],
  subsets: ["arabic"],
  variable: "--font-ibm-arabic",
  display: "swap",
});

const amiri = Amiri({
  weight: ["400", "700"],
  subsets: ["arabic"],
  variable: "--font-amiri",
  display: "swap",
});

export const metadata: Metadata = {
  title: "YTDL — YouTube Media Platform",
  description: "Download. Extract. Transcribe.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${archivoBlack.variable} ${interTight.variable} ${ibmPlexArabic.variable} ${amiri.variable}`}
      suppressHydrationWarning
    >
      <body className="font-body antialiased min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
