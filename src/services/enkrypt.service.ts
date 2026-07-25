// src/services/enkrypt.service.ts

export class EnkryptService {
  private readonly baseUrl = process.env.ENKRYPT_BASE_URL!;
  private readonly apiKey = process.env.ENKRYPT_API_KEY!;

  private async request<T>(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();

      throw new Error(
        `Enkrypt API Error (${response.status}): ${error}`
      );
    }

    return response.json();
  }

  /**
   * Prompt Injection Detection
   */
  async detectPromptInjection(text: string) {
    return this.request("/guardrails/detect", {
      text,
      detectors: {
        injection_attack: {
          enabled: true,
        },
      },
    });
  }

  /**
   * PII Detection
   */
  async detectPII(text: string) {
    return this.request("/guardrails/pii", {
      text,
    });
  }

  /**
   * Policy Validation
   */
  async validatePolicy(text: string, policyName: string) {
    return this.request("/guardrails/policy/detect", {
      text,
      policy_name: policyName,
    });
  }
}

export const enkryptService = new EnkryptService();