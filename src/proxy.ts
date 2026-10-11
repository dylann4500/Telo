import { NextResponse, type NextRequest } from "next/server";

// Through a public tunnel, only Dial's endpoints should be reachable (they
// check their own signature or token). The dashboard and its APIs answer
// only on this machine, unless TELO_DASHBOARD_PUBLIC=true.

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

function cameFromOutside(request: NextRequest): boolean {
  if (request.headers.get("cf-connecting-ip")) return true; // Cloudflare tunnel
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return Boolean(forwarded && !LOOPBACK.has(forwarded));
}

export function proxy(request: NextRequest) {
  if (process.env.TELO_DASHBOARD_PUBLIC === "true" || !cameFromOutside(request)) return NextResponse.next();
  return new NextResponse("Not found", { status: 404 });
}

export const config = {
  matcher: ["/((?!api/webhooks/dial|api/mcp|_next/static|_next/image|favicon.ico).*)"],
};
