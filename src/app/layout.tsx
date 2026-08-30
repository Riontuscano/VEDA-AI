import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/*
 * IBM Plex Sans carries real character at label sizes without reading as a
 * template, and its mono sibling pairing is designed for exactly this kind of
 * data-dense tool. JetBrains Mono handles every question label, count and
 * confidence figure, so numbers align in columns.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Answer Sheet Mapper",
  description:
    "Extract questions from a paper, read a handwritten answer sheet, and map every answer to the question it answers.",
};

// Props are typed inline rather than via Next's generated `LayoutProps`, which
// only exists after a build and would break `npm run typecheck` from clean.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
