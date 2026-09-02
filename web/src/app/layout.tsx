import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CopilotKit } from "@copilotkit/react-core";
import { ReviewNavProvider } from "@/lib/review-nav";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import { AGENT_NAME } from "@/lib/types";
import "@copilotkit/react-ui/styles.css";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "PR Reviewer",
  description: "Paste a pull request. Understand it in a minute. Ask anything.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Tailwind's dark variant is class-based; stamp the class before paint
            (stored preference, else OS) so the diff, mermaid and shiki themes agree. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">
        {/* No dev console toasts and no AG-UI inspector: the inspector is a Lit
            widget that re-renders on every streamed event and drags dev mode. */}
        <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_NAME} showDevConsole={false} enableInspector={false}>
          <ReviewNavProvider>{children}</ReviewNavProvider>
        </CopilotKit>
      </body>
    </html>
  );
}
