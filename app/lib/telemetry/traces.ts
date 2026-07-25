import { signoz } from "./signoz";
import { TraceSummary } from "./types";

export async function getTraceSummary(
    traceId: string
): Promise<TraceSummary | null> {

    return signoz.getTrace(traceId);
}