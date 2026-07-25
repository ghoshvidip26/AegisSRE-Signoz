# AegisSRE: OWASP API Gateway & Encryption Specification

This document details the security configurations and design patterns implemented in the AegisSRE infrastructure to comply with OWASP API Security Top 10 guidelines, Web Application Firewall (WAF) standards, and encryption mandates.

---

## 1. Kong API Gateway Integration

The Kong API Gateway acts as the entry point for all incoming alert payloads, client interactions, and webhook ingestion paths.

### A. Strict Input Validation (OWASP API1:2023 - Broken Object Level Authorization)
All incoming payloads must match strict JSON schema validation specifications.
* **Triage Ingest endpoint (`/api/incidents`) JSON Validation**:
  ```json
  {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
      "title": { "type": "string", "maxLength": 128 },
      "message": { "type": "string", "maxLength": 2048 },
      "service": { "type": "string", "maxLength": 64 },
      "severity": { "type": "string", "enum": ["P1", "P2", "P3", "P4"] }
    },
    "required": ["title", "message", "service"]
  }
  ```
* **Enforcement**: Payloads failing schema validation are immediately rejected at the Gateway layer with a `400 Bad Request` status code, preventing them from hitting downstream Next.js application runtimes or Mastra agents.

### B. Rate Limiting (OWASP API4:2023 - Unrestricted Resource Consumption)
Kong enforces rate limits using the `rate-limiting` plugin:
* **Limits**: 100 requests per minute per IP address.
* **Response**: `429 Too Many Requests` header with `Retry-After`.

---

## 2. Web Application Firewall (WAF) & Injection Protection

### A. SQL Injection (SQLi) Protection
* **Parameterized Queries**: All database interactions with the LibSQL store and Qdrant memory collections utilize strictly parameterized inputs.
* **Regex Filtering**: WAF rules inspect the URL, headers, and request body for typical SQL keyword sequences (`UNION SELECT`, `' OR 1=1--`, etc.) and block requests with a `403 Forbidden` response.

### B. Command Injection Prevention
Because AegisSRE executes infrastructure commands (e.g. `kubectl scale`), command execution is restricted:
* **Command Whitelisting**: The SRE execution agent is restricted to running commands matching strict whitelist regex patterns.
* **No Direct User Shell**: Shell commands are generated dynamically from pre-defined templates in Mastra tools and never executed directly from raw chat input.

---

## 3. Data Encryption Standards

### A. Encryption-in-Transit
* **TLS 1.3 Mandate**: All communication paths (client-to-gateway, gateway-to-app-server, app-server-to-Qdrant) must use TLS 1.3. 
* **Cipher Suites**: Restricted to secure modern suites (e.g., `TLS_AES_256_GCM_SHA384` and `TLS_CHACHA20_POLY1305_SHA256`).
* **HSTS**: `Strict-Transport-Security` headers are injected by the gateway with a `max-age` of 1 year.

### B. Encryption-at-Rest
* **Database Encryption**: All persistent databases (LibSQL database `mastra.db` and Qdrant vector database storage directories) are encrypted at the block layer using **AES-256-GCM**.
* **Key Management**: Encryption keys are rotated every 90 days via KMS integration.
