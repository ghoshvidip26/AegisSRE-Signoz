import { createOpenAI } from "@ai-sdk/openai";

/**
 * Fallback model using local Ollama via its OpenAI-compatible API.
 * Ollama exposes /v1/chat/completions at http://localhost:11434/v1
 *
 * This is used when the primary model (Gemini Flash) hits rate limits.
 * gemma3:1b is small and fast — fits comfortably on 8GB RAM.
 *
 * IMPORTANT: gemma3:1b does NOT support tool/function calling.
 * Always use with `toolChoice: "none"` when calling agent.generate().
 */
const ollama = createOpenAI({
    baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
    apiKey: "ollama", // Ollama doesn't require auth but the SDK requires a non-empty string
});

/** Local Ollama model — completion-only, no tool support */
export const fallbackModel = ollama("gemma3:1b");

/**
 * Model identifiers for Mastra agent configuration.
 * Primary: Gemini Flash (fast, high quality, rate-limited on free tier)
 * Fallback: Local Ollama gemma3:1b (always available, 815MB, no tool support)
 */
export const MODEL_CONFIG = {
    primary: process.env.OPENAI_API_KEY ? "openai/gpt-4o-mini" : "google/gemini-2.5-flash",
    fallbackProvider: ollama,
    fallbackModelId: "gemma3:1b",
} as const;
