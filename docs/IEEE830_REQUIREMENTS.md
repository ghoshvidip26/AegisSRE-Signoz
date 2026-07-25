# AegisSRE: IEEE 830 SRS Requirements & Traceability Matrix

This document defines functional and non-functional requirements in compliance with the **IEEE 830 SRS Standard**, along with quantifiable acceptance criteria and a traceability matrix linking requirements to architectural components.

---

## 1. Functional Requirements (FR)

| Req ID | Title | Description | Measurable Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **FR-001** | Alert Ingestion | Automatic ingestion of production alerts from PagerDuty/Sentry via Event Mesh. | Ingestion latency < 200ms from payload receipt to DB write. |
| **FR-002** | Telemetry Collection | Fetch real-time system logs and CPU/RAM/Network metrics upon alert ingestion. | Gather 100% of logs from the last 15 mins for the affected service. |
| **FR-003** | AI Incident Triage | Autonomous diagnosis and classification of root causes and severity. | Max 3 seconds to generate incident status, diagnosis, and severity level. |
| **FR-004** | Remediation Planning | Generate step-by-step shell commands to recover system from degradation. | Generate plan within 5 seconds; 100% of plans must contain safe commands. |
| **FR-005** | Decision Gateway (HITL)| Enforce human-in-the-loop approvals for high-risk execution commands. | 100% compliance with 'Four-Eyes' principle; block execution without approval. |
| **FR-006** | Automated Execution | Sequential execution of approved remediation steps against targets. | Run commands safely; halt immediately if any sub-step returns code != 0. |
| **FR-007** | Closed-Loop Verification | Query logs and metrics post-execution to verify if KPIs returned to baseline. | Verify restoration of target service CPU (<80%) and response codes (2xx/3xx). |
| **FR-008** | Automated Rollback | Trigger rollback commands if post-execution metrics do not restabilize. | Rollback action must trigger within 10 seconds of verification failure. |

---

## 2. Non-Functional Requirements (NFR)

| Req ID | Title | Description | Measurable Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **NFR-001** | High Availability | Ensure the command center engine remains highly available. | 99.9% uptime of API endpoints under a simulated load of up to 10k rps. |
| **NFR-002** | Security Gateway | Protect backend execution endpoints from arbitrary injections. | Zero vulnerabilities on OWASP Top 10 API Security tests. |
| **NFR-003** | Data Security | Secure persistent metrics, credentials, and data store records. | Encrypt all data-at-rest with AES-256 and data-in-transit with TLS 1.3. |
| **NFR-004** | Auditability | Record history of all diagnostic summaries, proposed actions, and user approvals. | Log 100% of transactions to the immutable Mastra storage log. |

---

## 3. Requirements Traceability Matrix (RTM)

This matrix maps Functional and Non-Functional requirements directly to agents, workflows, and memory collections:

| Req ID | Component Type | Target Component | Status / Coverage |
| :--- | :--- | :--- | :--- |
| **FR-001** | API Route | `/api/incidents` | Implemented |
| **FR-002** | Tools | `logTool`, `metricsTool` | Implemented |
| **FR-003** | Mastra Agent | `diagnosisAgent` (via `diagnosisPrompt`) | Implemented |
| **FR-004** | Mastra Agent | `planningAgent` (via `planningPrompt`) | Implemented |
| **FR-005** | Workflow Step | `coordinatorStep` / Decision Gateway | Implemented |
| **FR-006** | Mastra Agent | `executionAgent` | Implemented |
| **FR-007** | Mastra Agent | `verificationAgent` | Implemented |
| **FR-008** | Workflow Step | `verificationStep` Rollback Engine | Implemented |
| **NFR-001** | Infrastructure | Next.js API Routes | Implemented |
| **NFR-002** | API Gateway | Kong API Gateway + Enkrypt AI Proxy | Documented |
| **NFR-003** | Storage / Network | LibSQL Store (AES-256) / TLS 1.3 Paths | Documented |
| **NFR-004** | Storage / memory | Qdrant Memory Collections | Implemented |
