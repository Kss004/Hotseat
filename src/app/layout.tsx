import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI-Powered Role-Play Preparation Coach | Executive Sparring",
  description:
    "Analyze professional profiles, predict high-stakes meeting objections, and spar with realistic AI executive personas before the actual meeting.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isReplayMode = process.env.LLM_MODE === "replay";

  return (
    <html lang="en">
      <body id="app-root">
        {isReplayMode && (
          <div className="replay-banner" id="replay-mode-banner">
            ⚠️ REPLAY MODE ACTIVE: Serving recorded fixtures for automated testing
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
