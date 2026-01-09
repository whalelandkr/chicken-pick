import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChickenPick - Official Guide",
  description: "Korean Chicken Guide for Global Foodies",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Pretendard 폰트 CDN 적용 */}
        <link rel="stylesheet" as="style" crossOrigin="anonymous" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.8/dist/web/static/pretendard.css" />
      </head>
      <body className="font-['Pretendard'] bg-[#f3f4f6] text-gray-900 antialiased overflow-y-scroll">
        {children}
      </body>
    </html>
  );
}