import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin-guard";
import {
  HERO_DEFAULTS,
  HERO_LIMITS,
  getHeroCopy,
  saveHeroCopy,
} from "@/lib/hero";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/hero — saved homepage hero copy + the built-in defaults.
 * The panel shows the defaults as placeholders so "reset" is obvious.
 */
export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({
      hero: await getHeroCopy(),
      defaults: HERO_DEFAULTS,
      limits: HERO_LIMITS,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/admin/hero — save. Body: { headline?, accent?, body? }. */
export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await saveHeroCopy(body);
    if (!result.ok) {
      return NextResponse.json(
        { error: "Invalid hero copy", errors: result.errors },
        { status: 400 }
      );
    }
    // The homepage is ISR (revalidate = 300); this makes the save immediate.
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, hero: result.copy });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
