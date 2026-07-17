import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://chat.vercel.ai"),
  title: "Epistack",
  description:
    "A multiplayer epistemic commons — investigate together, keep receipts, choose your trust at read time.",
};

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

const LIGHT_THEME_COLOR = "hsl(0 0% 100%)";
const DARK_THEME_COLOR = "hsl(240deg 10% 3.92%)";
const THEME_COLOR_SCRIPT = `\
(function() {
  var html = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  function updateThemeColor() {
    var isDark = html.classList.contains('dark');
    meta.setAttribute('content', isDark ? '${DARK_THEME_COLOR}' : '${LIGHT_THEME_COLOR}');
  }
  var observer = new MutationObserver(updateThemeColor);
  observer.observe(html, { attributes: true, attributeFilter: ['class'] });
  updateThemeColor();
})();`;

// Comment highlights (CSS Custom Highlight API). Shipped as a raw <style> tag
// because Turbopack's CSS parser rejects the ::highlight() pseudo-element and
// would drop the rules from globals.css. One name per palette hue
// (lib/realtime/color.ts HUES) — a thread's highlight wears its author's
// color, matching their avatar and cursor. Private notes get a subtler wash.
const HIGHLIGHT_HUES = [25, 60, 95, 175, 210, 250, 320, 350];
const COMMENT_HIGHLIGHT_CSS = [
  ...HIGHLIGHT_HUES.map(
    (h) =>
      `::highlight(comment-h${h}) { background-color: oklch(0.62 0.14 ${h} / 0.22); }`
  ),
  "::highlight(comment-private) { text-decoration: underline dashed oklch(0.62 0.02 250 / 0.6); text-underline-offset: 3px; background-color: oklch(0.62 0.02 250 / 0.12); }",
].join("\n");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${geist.variable} ${geistMono.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: "Required"
          dangerouslySetInnerHTML={{
            __html: THEME_COLOR_SCRIPT,
          }}
        />
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static CSS the bundler can't parse (::highlight)
          dangerouslySetInnerHTML={{
            __html: COMMENT_HIGHLIGHT_CSS,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
