import { fallbackModel } from "./fallback";

export type FailoverResult = {
    text: string;
    provider: "primary" | "fallback";
    attempts: number;
};

type AgentLike = {
    generate: (prompt: string, opts?: unknown) => Promise<{ text: string }>;
};

type FailoverOpts = {
    toolChoice?: "auto" | "none";
    retryDelayMs?: number;
};

const isTransient = (err: unknown): boolean => {
    if (!(err instanceof Error)) return false;

    const anyErr = err as {
        statusCode?: number;
        isRetryable?: boolean;
        name?: string;
    };

    if (typeof anyErr.statusCode === "number" && anyErr.statusCode >= 500) return true;
    if (anyErr.isRetryable === true) return true;
    if (anyErr.name === "AI_APICallError") return true;

    const msg = err.message.toLowerCase();
    return (
        msg.includes("rate limit") ||
        msg.includes("429") ||
        msg.includes("resource_exhausted") ||
        msg.includes("timeout") ||
        msg.includes("econnreset") ||
        msg.includes("500") ||
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("service unavailable")
    );
};

/**
 * Wraps agent.generate() with probe → single retry → Ollama fallback.
 * Any LLM call inside a workflow step should route through this.
 */
export async function generateWithFailover(
    agent: AgentLike,
    prompt: string,
    opts: FailoverOpts = {}
): Promise<FailoverResult> {
    const delay = opts.retryDelayMs ?? 2000;
    const primaryOpts = opts.toolChoice ? { toolChoice: opts.toolChoice } : undefined;

    try {
        const res = await agent.generate(prompt, primaryOpts);
        return { text: res.text, provider: "primary", attempts: 1 };
    } catch (err) {
        if (!isTransient(err)) throw err;
        console.warn(
            `[failover] primary LLM transient error, retrying in ${delay}ms:`,
            err instanceof Error ? err.message : err
        );
    }

    await new Promise((r) => setTimeout(r, delay));

    try {
        const res = await agent.generate(prompt, primaryOpts);
        return { text: res.text, provider: "primary", attempts: 2 };
    } catch (err) {
        if (!isTransient(err)) throw err;
        console.warn(
            "[failover] retry failed, switching to Ollama fallback:",
            err instanceof Error ? err.message : err
        );
    }

    const res = await agent.generate(prompt, {
        model: fallbackModel,
        toolChoice: "none",
    });
    return { text: res.text, provider: "fallback", attempts: 3 };
}
