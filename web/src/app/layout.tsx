import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Onebeat Studio",
  description: "用于快速生成文本、图片和视频的内部工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
