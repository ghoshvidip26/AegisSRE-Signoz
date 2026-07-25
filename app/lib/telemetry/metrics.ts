import { signoz } from "./signoz";
import { TelemetryMetrics } from "./types";

export async function getServiceMetrics(
    service: string
): Promise<TelemetryMetrics | null> {

    return signoz.getMetrics(service);
}