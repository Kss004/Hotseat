import { NextResponse } from "next/server";
import { scrapeLinkedInMetadata } from "@/lib/scraper/linkedin";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const url = body?.url;

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { ok: false, reason: "A valid URL string is required" },
        { status: 400 }
      );
    }

    const result = await scrapeLinkedInMetadata(url);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: "Couldn't read this profile. Paste the text instead." },
      { status: 500 }
    );
  }
}
