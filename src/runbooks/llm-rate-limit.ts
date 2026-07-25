import { register } from "./registry";
import { fallbackModel } from "@/src/models/fallback";
import { isRateLimitError } from "@/lib/utils/retry";
import type { ExecutorResult, Runbook } from "./types";

const PROBE_AGENT = "diagnosisAgent";
const PROBE_PROMPT = "Reply with the single word OK.";
const RETRY_DELAY_MS = 2000;

const step = (ok: boolean, stdout?: string, stderr?: string): ExecutorResult => ({
    ok,
    stdout,
    stderr,
});

const errMsg = (err: unknown): string =>
    err instanceof Error ? err.message : "unknown error";

const sleep = (ms: number): Promise<void> =>
    new Promise((r) => setTimeout(r, ms));

export const llmRateLimitRunbook: Runbook = {
    id: "llm-rate-limit",
    description:
        "Recover LLM pipeline degradation: probe primary, retry once, then fail over to Ollama fallback.",
    riskTier: "low",

    match(diagnosis) {
        const text = `${diagnosis.rootCause} ${diagnosis.recommendation}`.toLowerCase();
        const service = diagnosis.affectedService.toLowerCase();

        const isLLM =
            service.includes("llm") ||
            service.includes("openai") ||
            service.includes("gemini") ||
            text.includes("gpt-") ||
            text.includes("gemini") ||
            text.includes("openai");

        const isRateLimit =
            text.includes("rate limit") ||
            text.includes("429") ||
            text.includes("resource_exhausted") ||
            text.includes("quota") ||
            diagnosis.category === "llm_rate_limit";

        if (isLLM && isRateLimit) {
            return { confidence: 0.9, reason: "LLM rate-limit signal" };
        }
        if (isLLM) {
            return { confidence: 0.5, reason: "LLM-related service, no explicit rate-limit signal" };
        }
        return { confidence: 0, reason: "Not an LLM issue" };
    },

    async execute(_diagnosis, { generate }) {
        if (!generate) {
            return {
                status: "failed",
                summary:
                    "Runbook context missing `generate`. Wire ctx.generate in the workflow before running this runbook.",
                steps: [],
            };
        }

        const steps: Array<{ command: string; result: ExecutorResult }> = [];

        // 1. Check provider status — probe primary
        try {
            const probe = await generate(PROBE_AGENT, PROBE_PROMPT);
            steps.push({
                command: "probe primary",
                result: step(true, probe.text.trim().slice(0, 80)),
            });
            return {
                status: "success",
                summary: "Primary LLM responsive — no remediation needed.",
                steps,
            };
        } catch (err) {
            steps.push({
                command: "probe primary",
                result: step(false, undefined, errMsg(err)),
            });
            if (!isRateLimitError(err)) {
                return {
                    status: "failed",
                    summary: `Primary probe failed with non-retryable error: ${errMsg(err)}`,
                    steps,
                };
            }
        }

        // 2. Retry once after a short backoff
        await sleep(RETRY_DELAY_MS);
        try {
            const retry = await generate(PROBE_AGENT, PROBE_PROMPT);
            steps.push({
                command: `retry primary (after ${RETRY_DELAY_MS}ms)`,
                result: step(true, retry.text.trim().slice(0, 80)),
            });
            return {
                status: "success",
                summary: "Primary LLM recovered after a single retry.",
                steps,
            };
        } catch (err) {
            steps.push({
                command: `retry primary (after ${RETRY_DELAY_MS}ms)`,
                result: step(false, undefined, errMsg(err)),
            });
        }

        // 3. Switch to fallback (Ollama gemma3:1b, tool-free)
        try {
            const fb = await generate(PROBE_AGENT, PROBE_PROMPT, {
                model: fallbackModel,
                toolChoice: "none",
            });
            steps.push({
                command: "switch to fallback (ollama gemma3:1b)",
                result: step(true, fb.text.trim().slice(0, 80)),
            });
            return {
                status: "partial",
                summary: "Primary LLM still rate-limited. Serving via Ollama fallback (tool-free).",
                steps,
            };
        } catch (err) {
            steps.push({
                command: "switch to fallback (ollama gemma3:1b)",
                result: step(false, undefined, errMsg(err)),
            });
            return {
                status: "failed",
                summary: `Primary and fallback both failed. Last error: ${errMsg(err)}`,
                steps,
            };
        }
    },

    async verify(_diagnosis, { generate }) {
        if (!generate) {
            return {
                resolved: false,
                evidence: ["ctx.generate not available for verification"],
            };
        }

        const evidence: string[] = [];
        const verifyPrompt = "Reply with the single word PONG.";

        try {
            const primary = await generate(PROBE_AGENT, verifyPrompt);
            const text = primary.text.trim();
            evidence.push(`primary probe → ${text.slice(0, 80)}`);
            if (text.toUpperCase().includes("PONG")) {
                return { resolved: true, evidence };
            }
        } catch (err) {
            evidence.push(`primary probe failed: ${errMsg(err)}`);
        }

        try {
            const fb = await generate(PROBE_AGENT, verifyPrompt, {
                model: fallbackModel,
                toolChoice: "none",
            });
            const text = fb.text.trim();
            evidence.push(`fallback probe → ${text.slice(0, 80)}`);
            return {
                resolved: text.toUpperCase().includes("PONG"),
                evidence,
            };
        } catch (err) {
            evidence.push(`fallback probe failed: ${errMsg(err)}`);
            return { resolved: false, evidence };
        }
    },
};

register(llmRateLimitRunbook);
