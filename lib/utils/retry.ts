/**
 * Retry configuration for handling transient failures (rate limits, network issues).
 */
export interface RetryConfig {
  /** Maximum number of attempts (including the first try) */
  maxAttempts: number;
  /** Initial delay in ms before first retry */
  initialDelay: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Maximum delay cap in ms */
  maxDelay: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 5000,
  backoffMultiplier: 3,
  maxDelay: 30000,
};

/**
 * Determines if an error is a rate limit error that should be retried.
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('too many requests') ||
      msg.includes('resource exhausted') ||
      msg.includes('quota exceeded')
    );
  }
  return false;
}

/**
 * Determines if an error is transient and worth retrying.
 * Recognizes AI SDK errors by statusCode / isRetryable / name — the message
 * string alone often omits the status (e.g. OpenAI 500s return a generic body).
 */
function isRetryableError(error: unknown): boolean {
  if (isRateLimitError(error)) return true;

  if (error instanceof Error) {
    const anyErr = error as { statusCode?: number; isRetryable?: boolean; name?: string };
    if (typeof anyErr.statusCode === 'number' && anyErr.statusCode >= 500) return true;
    if (anyErr.isRetryable === true) return true;
    if (anyErr.name === 'AI_APICallError') return true;

    const msg = error.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('network') ||
      msg.includes('503') ||
      msg.includes('502') ||
      msg.includes('500') ||
      msg.includes('service unavailable')
    );
  }
  return false;
}

/**
 * Execute a function with exponential backoff retry for rate limits and transient errors.
 * 
 * @returns { result, attempts } on success
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<{ result: T; attempts: number }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt };
    } catch (error) {
      lastError = error;

      // Don't retry on the last attempt or non-retryable errors
      if (attempt === config.maxAttempts || !isRetryableError(error)) {
        throw error;
      }

      // Calculate delay with exponential backoff + jitter
      const baseDelay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1);
      const jitter = Math.random() * 0.3 * baseDelay; // ±30% jitter
      const delay = Math.min(baseDelay + jitter, config.maxDelay);

      console.log(
        `[retry] Attempt ${attempt}/${config.maxAttempts} failed (${error instanceof Error ? error.message : 'unknown'}). Retrying in ${Math.round(delay)}ms...`
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
