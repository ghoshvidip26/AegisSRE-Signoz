import type { NextRequest } from "next/server";

export type ApiKeyCheck =
    | { ok: true; required: boolean }
    | { ok: false; required: true; status: 401; error: string };

/**
 * Checks the Authorization header against AEGIS_API_KEY.
 *
 * Opt-in: if AEGIS_API_KEY is unset (the default), this is a complete
 * no-op — every request passes, identical to before this check existed.
 * Set it to require `Authorization: Bearer <key>` on requests. Both the
 * Node and Python SDKs already support passing an apiKey; this is what
 * finally enforces it server-side.
 */
export function checkApiKey(req: NextRequest): ApiKeyCheck {
    const expected = process.env.AEGIS_API_KEY;
    if (!expected) {
        return { ok: true, required: false };
    }

    const header = req.headers.get("authorization") ?? "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || token !== expected) {
        return {
            ok: false,
            required: true,
            status: 401,
            error: "Missing or invalid Authorization header. Expected: Bearer <AEGIS_API_KEY>",
        };
    }

    return { ok: true, required: true };
}
