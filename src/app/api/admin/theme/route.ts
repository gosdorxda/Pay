import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin-guard";
import {
  FALLBACK_DEFAULT_THEME,
  getDefaultTheme,
  saveDefaultTheme,
} from "@/lib/theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/theme — the saved DEFAULT theme for first-time visitors.
 * A visitor's own toggle (localStorage `theme`) always overrides it.
 */
export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({
      value: await getDefaultTheme(),
      fallback: FALLBACK_DEFAULT_THEME,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/admin/theme — save. Body: { value: "dark" | "light" }. */
export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const value = await saveDefaultTheme(body.value);
    // The value is baked into the inline <script> in the root layout.
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, value });
  } catch (e) {
    const message = (e as Error).message;
    const status = message.includes("must be") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
