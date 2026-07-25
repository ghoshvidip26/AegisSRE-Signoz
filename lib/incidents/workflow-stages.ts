import type { IncidentOperation } from "./incident";

export type StageStatus = "pending" | "running" | "waiting" | "completed" | "failed";

export const STAGE_ORDER: { step: IncidentOperation["step"]; label: string }[] = [
    { step: "coordinator", label: "Coordinator" },
    { step: "classify", label: "Classifier" },
    { step: "diagnose", label: "Diagnosis" },
    { step: "planning", label: "Planning" },
    { step: "approval", label: "Approval" },
    { step: "execute", label: "Execution" },
    { step: "verify", label: "Verification" },
];

export type Stage = {
    step: IncidentOperation["step"];
    label: string;
    status: StageStatus;
    startTime: number | null;
    endTime: number | null;
    durationMs: number | null;
    operations: IncidentOperation[];
};

/**
 * Single source of truth for turning the flat operations log into per-stage
 * status. Used both server-side (the pipeline shape returned by
 * GET /api/incidents/:id) and client-side (the Workflow tab / dashboard
 * canvas) — previously these derived pipeline state two different, drifting
 * ways (a hand-maintained incident.status switch vs. the richer operations
 * log); this makes them agree by construction.
 */
export function groupStages(operationsLog: IncidentOperation[]): Stage[] {
    return STAGE_ORDER.map(({ step, label }) => {
        const operations = operationsLog.filter((op) => op.step === step);
        if (operations.length === 0) {
            return { step, label, status: "pending", startTime: null, endTime: null, durationMs: null, operations };
        }

        const timestamps = operations.map((op) => op.timestamp);
        const startTime = Math.min(...timestamps);
        const endTime = Math.max(...timestamps);
        const last = operations[operations.length - 1];

        // Trust the terminal entry, not "did any sub-step ever fail" — a
        // runbook step can legitimately log an intermediate failed check
        // (e.g. a pre-restart ping that's expected to fail) and still
        // finish the stage successfully, so only the last entry's status
        // is authoritative.
        let status: StageStatus;
        if (last.status === "failed") status = "failed";
        else if (last.status === "waiting") status = "waiting";
        else if (last.status === "completed") status = "completed";
        else status = "running";

        return {
            step,
            label,
            status,
            startTime,
            endTime,
            durationMs: operations.length > 1 ? endTime - startTime : (last.duration ?? null),
            operations,
        };
    });
}
