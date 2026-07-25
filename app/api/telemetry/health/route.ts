import { NextResponse } from "next/server";

const SIGNOZ_URL = process.env.SIGNOZ_URL ?? "http://localhost:8080";

// Cached briefly so the dashboard's 5s polling doesn't hammer SigNoz with a
// reachability check on every tick.
const CACHE_TTL_MS = 15_000;
let cached: { healthy: boolean; checkedAt: number } | null = null;

export async function GET() {
    if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
        return NextResponse.json({ healthy: cached.healthy });
    }

    let healthy = false;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(SIGNOZ_URL, { signal: controller.signal });
        clearTimeout(timeout);
        healthy = res.ok;
    } catch {
        healthy = false;
    }

    cached = { healthy, checkedAt: Date.now() };
    return NextResponse.json({ healthy });
}
