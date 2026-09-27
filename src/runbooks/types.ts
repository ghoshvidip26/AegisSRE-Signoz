export type DiagnosisInput = {
    rootCause: string;
    severity: string;
    affectedService: string;
    recommendation: string;
    category?: string;
};

export type MatchResult = {
    confidence: number;
    reason: string;
};

export type ExecutorResult = {
    ok: boolean;
    stdout?: string;
    stderr?: string;
    /**
     * Aegis-Firewall's verdict on this command, if the MCP sidecar was
     * reachable. Absent (not just undefined-decision) means the firewall
     * check itself failed and the command ran fail-open — surfaced in the UI
     * so an ALLOW-by-connectivity-failure doesn't look identical to a real
     * policy ALLOW.
     */
    firewall?: {
        decision: "ALLOW" | "PENDING" | "BLOCK";
        reason: string;
        severity: string;
        riskScore: number;
    };
};

export type Executor = {
    /**
     * `label` is the human-readable name shown in the live operations log
     * for this command — use it when the raw shell string is noisy (an nvm
     * init prefix) or ambiguous (the same ping run before and after a fix).
     * Defaults to the command itself.
     */
    run(command: string, opts?: { timeoutMs?: number; label?: string }): Promise<ExecutorResult>;
};

export type ExecuteResult = {
    status: "success" | "partial" | "failed";
    summary: string;
    steps: Array<{ command: string; result: ExecutorResult }>;
    /**
     * Real, runbook-specific telemetry (e.g. Redis ping latency/connections,
     * Node current/required version) — only set by runbooks that have a
     * natural telemetry shape to report. Merged onto the incident record by
     * the workflow, not written directly by runbooks (they have no access
     * to the incident store).
     */
    telemetry?: Record<string, unknown>;
};

export type VerifyResult = {
    resolved: boolean;
    evidence: string[];
    telemetry?: Record<string, unknown>;
};

export type GenerateOptions = {
    model?: unknown;
    toolChoice?: "auto" | "none";
};

export type GenerateFn = (
    agentId: string,
    prompt: string,
    opts?: GenerateOptions
) => Promise<{ text: string }>;

export type RunbookContext = {
    executor: Executor;
    generate?: GenerateFn;
};

export type Runbook = {
    id: string;
    description: string;
    riskTier: "low" | "medium" | "high" | "critical";
    match(diagnosis: DiagnosisInput): MatchResult;
    execute(diagnosis: DiagnosisInput, ctx: RunbookContext): Promise<ExecuteResult>;
    verify(diagnosis: DiagnosisInput, ctx: RunbookContext): Promise<VerifyResult>;
};