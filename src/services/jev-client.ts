import { TypeSafeClient, choice } from "@typesafe-ai/sdk";

/**
 * Lazily-constructed TypeSafe client. `new TypeSafeClient()` throws when
 * `TYPESAFE_API_KEY` isn't set, so construction is deferred to the first call
 * and the failure is cached — callers treat "no key configured" exactly like
 * any other Jev failure: fall back to the LLM classifier instead of crashing
 * the workflow.
 */
let client: TypeSafeClient | null | undefined;

function getClient(): TypeSafeClient | null {
    if (client !== undefined) return client;
    try {
        client = new TypeSafeClient();
    } catch (err) {
        console.warn(
            "[jev-client] TypeSafeClient unavailable (TYPESAFE_API_KEY not set?) — classification will use the LLM fallback:",
            err instanceof Error ? err.message : err
        );
        client = null;
    }
    return client;
}

/**
 * Closed set of failure categories the incident workflow understands. This
 * mirrors the category enum the legacy `classifierPrompt` (see
 * `src/prompts/classifier-prompt.ts`) asked an LLM to freeform-emit as JSON —
 * kept identical so runbook `match()` checks (`diagnosis.category === "..."`,
 * see `src/runbooks/*.ts`) see exactly the same values as before.
 */
const CATEGORY_CRITERIA = {
    cache_unavailable: "Redis, Memcached, or another cache is down or refusing connections.",
    pod_crashloop: "Kubernetes pods are in CrashLoopBackOff, OOMKilled, or repeatedly restarting.",
    pool_exhausted: "A connection, thread, or other resource pool is saturated.",
    network_error: "DNS failure, connection refused, or socket errors reaching an external endpoint.",
    disk_pressure: "Out of disk space, inode exhaustion, or a quota exceeded.",
    error_spike: "Elevated error rate, a flood of 5xx responses, or a latency spike.",
    deploy_regression: "Errors correlated with a recent deploy or configuration change.",
    dependency_error: "An external API or service is down — for example Stripe, S3, or another third party.",
    runtime_error: "A language runtime issue, such as a Node version mismatch or a missing module.",
    git_error: "A git operation failed: diverged branches, a merge conflict, or a hook failure.",
    llm_provider_error: "An LLM API is rate-limited, over quota, or degraded.",
    unknown: "Doesn't clearly match any other category.",
} as const;

/**
 * Closed set of affected services. Narrower than the free-text `service`
 * field the old prompt emitted, but it covers every service the runbook
 * registry actually matches on (see `src/runbooks/*.ts`'s
 * `diagnosis.affectedService.toLowerCase().includes(...)` checks) plus the
 * services named in the classifier's own few-shot examples.
 */
const SERVICE_CRITERIA = {
    redis: "Redis or another in-memory cache.",
    kubernetes: "A Kubernetes pod, deployment, or cluster component.",
    postgres: "A PostgreSQL database.",
    "node-runtime": "The Node.js runtime or its version/toolchain.",
    git: "A git repository or branch operation.",
    stripe: "The Stripe payments API.",
    s3: "Amazon S3 or another object storage service.",
    openai: "The OpenAI API or another LLM provider.",
    unknown: "None of the above, or the affected system isn't named in the report.",
} as const;

export type JevCategory = keyof typeof CATEGORY_CRITERIA;
export type JevService = keyof typeof SERVICE_CRITERIA;

export type JevClassification = {
    category: JevCategory;
    service: JevService;
    /** The category answer's confidence — the direct replacement for the old prompt's self-reported `confidence` field. */
    confidence: number;
    source: "jev";
};

/**
 * Fast triage classification via TypeSafe's Jev model: a Choice over the
 * failure-category set and a second Choice over the affected service, asked
 * together in one request (see https://docs.typesafe.ai/primitives/choice).
 *
 * This replaces the classifier step's previous approach — a full LLM
 * completion asked to emit raw JSON, then recovered with regex/fence
 * stripping — with a typed call that returns a real probability
 * distribution and a calibrated `confidence` instead of a self-reported
 * number the model made up.
 *
 * Returns `null` when Jev isn't configured or the call fails (missing API
 * key, rate limit, network error, ...), so the caller can fall back to the
 * LLM-based `classifierAgent` rather than failing the workflow step.
 */
export async function classifyIncidentWithJev(
    incidentDescription: string
): Promise<JevClassification | null> {
    const jev = getClient();
    if (!jev) return null;

    try {
        const { answers } = await jev.systemOne({
            state: { incident_report: incidentDescription },
            questions: {
                category: choice(
                    "Which standardized failure category best describes this incident report?",
                    CATEGORY_CRITERIA
                ),
                service: choice(
                    "Which system or service is affected, based on `incident_report`?",
                    SERVICE_CRITERIA
                ),
            },
        });

        return {
            category: answers.category.choice,
            service: answers.service.choice,
            confidence: answers.category.confidence,
            source: "jev",
        };
    } catch (err) {
        console.warn(
            "[jev-client] classification call failed, falling back to LLM classifier:",
            err instanceof Error ? err.message : err
        );
        return null;
    }
}
