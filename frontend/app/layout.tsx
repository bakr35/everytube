import type { Metadata } from "next";
import { Archivo_Black, Inter_Tight } from "next/font/google";
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
    <html lang="en" className={`${archivoBlack.variable} ${interTight.variable}`}>
      <body className="bg-black text-white font-body antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
