import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ХОТ ТӨЛӨВЛӨЛТИЙН СИСТЕМ",
  description: "Монгол орны дурын газрын тохиромжтой байдлыг үнэлж, суурьшил төлөвлөх систем.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mn">
      <body>{children}</body>
    </html>
  );
}
