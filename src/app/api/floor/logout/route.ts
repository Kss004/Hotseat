import { NextResponse } from "next/server";
import { managerCookieHeader } from "@/lib/floor/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", managerCookieHeader("", 0));
  return res;
}
