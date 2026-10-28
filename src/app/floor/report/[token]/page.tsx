import type { Metadata } from "next";
import { RepReport } from "@/components/floor/RepReport";

export const metadata: Metadata = {
  title: "Practice call report | Hotseat Floor",
  robots: { index: false, follow: false },
};

export default function ReportPage({ params }: { params: { token: string } }) {
  return <RepReport token={decodeURIComponent(params.token)} />;
}
