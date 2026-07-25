import { format } from "node:util";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

/**
 * Mirrors console.log/info/warn/error to the OTel Logs signal, correlated
 * with whatever trace/span is active at call time (SigNoz then lets you
 * click a trace and see its exact log lines inline).
 *
 * Deliberately non-invasive: the original console method always runs first
 * and unmodified — same stdout/stderr output, same formatting, same
 * behavior as before this file existed. The OTel emit is a side effect
 * wrapped in try/catch that can never throw or block; if SigNoz is
 * unreachable, your terminal output is completely unaffected.
 */
export function installConsoleBridge(): void {
    const logger = logs.getLogger("aegis-sre-console");

    const bridge = (
        severityNumber: SeverityNumber,
        severityText: string,
        original: (...args: unknown[]) => void
    ) => {
        return (...args: unknown[]) => {
            original(...args);
            try {
                logger.emit({
                    severityNumber,
                    severityText,
                    body: format(...args),
                });
            } catch {
                // Never let telemetry break the original console call.
            }
        };
    };

    console.log = bridge(SeverityNumber.INFO, "INFO", console.log.bind(console));
    console.info = bridge(SeverityNumber.INFO, "INFO", console.info.bind(console));
    console.warn = bridge(SeverityNumber.WARN, "WARN", console.warn.bind(console));
    console.error = bridge(SeverityNumber.ERROR, "ERROR", console.error.bind(console));
}
