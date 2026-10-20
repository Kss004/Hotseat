import { NextResponse } from "next/server";
import { scrapeLinkedInMetadata } from "@/lib/scraper/linkedin";
import { isAppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    await enforceRateLimit(req, "linkedin-fetch");
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
    if (isAppError(err) && err.code === "RATE_LIMITED") {
      return NextResponse.json({ ok: false, code: err.code, reason: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { ok: false, reason: "Couldn't read this profile. Paste the text instead." },
      { status: 500 }
    );
  }
}
