import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nocturne | Adaptive Fear Engine",
  description: "Live operator dashboard for an adaptive VR horror session.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
