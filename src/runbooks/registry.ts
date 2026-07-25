import type { DiagnosisInput, Runbook } from "./types";

const runbooks = new Map<string, Runbook>();

export function register(runbook: Runbook): void {
    // Allow re-registration in dev mode (hot reload re-evaluates modules)
    runbooks.set(runbook.id, runbook);
}

export function get(id: string): Runbook | undefined {
    return runbooks.get(id);
}

export function all(): Runbook[] {
    return Array.from(runbooks.values());
}

export type Candidate = {
    runbook: Runbook;
    confidence: number;
    reason: string;
};

export function candidates(diagnosis: DiagnosisInput, threshold = 0.5): Candidate[] {
    const results: Candidate[] = [];
    for (const runbook of runbooks.values()) {
        const match = runbook.match(diagnosis);
        if (match.confidence >= threshold) {
            results.push({ runbook, confidence: match.confidence, reason: match.reason });
        }
    }
    return results.sort((a, b) => b.confidence - a.confidence);
}