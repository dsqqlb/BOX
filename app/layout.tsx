import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOX - 我的工具箱",
  description: "各种实用工具和学习资源的展示平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
