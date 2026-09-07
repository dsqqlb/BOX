import type { Metadata } from "next";
import type { Viewport } from "next";
import "./globals.css";
import DisableZoom from "@/components/common/DisableZoom";

export const metadata: Metadata = {
  title: "BOX - 我的工具箱",
  description: "各种实用工具和学习资源的展示平台",
};

// 全站按“应用”体验处理：移动端禁用双指缩放、双击缩放与可缩放 viewport。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('box-theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased">
        <DisableZoom />
        {children}
      </body>
    </html>
  );
}
