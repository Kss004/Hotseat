import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessToken } from "@/lib/access";

/** When ACCESS_CODE is set, every page and API route requires the cookie that /api/access issues. */
export async function middleware(req: NextRequest) {
  const code = process.env.ACCESS_CODE;
  if (!code) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (pathname === "/access" || pathname === "/api/access") return NextResponse.next();

  const cookie = req.cookies.get(ACCESS_COOKIE)?.value;
  if (cookie && cookie === (await accessToken(code))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { code: "ACCESS_REQUIRED", message: "Your access has expired. Reload the page and enter the access code." },
      { status: 401 }
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/access";
  url.search = "";
  url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
