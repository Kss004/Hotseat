import type { Metadata } from "next";
import { FloorApp } from "@/components/floor/FloorApp";

export const metadata: Metadata = {
  title: "Hotseat Floor | Morning practice calls",
  description: "Batch practice calls for a sales floor, scored with quote-verified evidence.",
};

export default function FloorPage() {
  return <FloorApp />;
}
