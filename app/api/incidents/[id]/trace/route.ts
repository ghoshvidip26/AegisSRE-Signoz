import { NextRequest, NextResponse } from "next/server";
import { incidentStore } from "@/lib/incidents/incident-store";
import { signoz, getSigNozTraceUrl } from "@/app/lib/telemetry/signoz";

/**
 * Wraps signoz.getTrace() as its own endpoint, kept separate from the main
 * incident GET so a slow/unreachable SigNoz doesn't block the rest of the
 * Incident Details page from rendering — the frontend fetches this
 * independently for just the Trace tab/card.
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const incident = incidentStore.get(id);

    if (!incident) {
        return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    }

    if (!incident.trace?.traceId) {
        return NextResponse.json({ trace: null, signozUrl: null });
    }

    const trace = await signoz.getTrace(incident.trace.traceId);

    return NextResponse.json({
        trace,
        signozUrl: getSigNozTraceUrl(incident.trace.traceId),
    });
}
