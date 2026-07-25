# Product Requirements Document (PRD): Autonomous DevOps SRE Engine

## 1. Executive Summary
The **Autonomous DevOps SRE Engine** (AegisSRE) is an enterprise-grade, governed autonomous system designed to ingest production alerts, diagnose root causes, and execute remediations within a high-security, human-in-the-loop framework. The system transitions from simple automation to "Governed Autonomy" by utilizing a multi-agent orchestration layer (Mastra) and semantic memory (Qdrant) to act as a "Junior SRE." It provides the speed of AI while ensuring humans retain ultimate authority over production-critical actions through a centralized **Decision Gateway** and a robust safety layer (Enkrypt AI and OPA).

## 2. Problem Statement
Modern cloud-native environments generate a high volume of alerts, leading to "alert fatigue" and slow Mean Time to Resolution (MTTR). While autonomous agents offer a solution, they introduce significant risks:
*   **Non-deterministic behavior:** LLMs may generate unsafe or hallucinated commands.
*   **Lack of Context:** Standard automation lacks historical knowledge of past incidents.
*   **Security Risks:** Executing code in production requires strict isolation and policy enforcement.
*   **Trust Gap:** Organizations are hesitant to grant AI "write access" to production without rigorous, auditable oversight.

## 3. Goals & Objectives
*   **Reduce MTTR:** Automate diagnosis and low-risk remediation to resolve incidents in minutes.
*   **Governed Autonomy:** Implement a "Defense-in-Depth" safety model where AI actions are gated by a centralized Decision Gateway.
*   **Contextual Intelligence:** Leverage historical post-mortems and runbooks via Qdrant vector memory.
*   **Operational Safety:** Ensure 100% isolation of execution environments using Firecracker MicroVMs.
*   **Enterprise Trust:** Provide a full audit trail and "Explainability Manifest" for every action taken.

## 4. Target Users / Stakeholders
*   **Site Reliability Engineers (SREs):** Primary operators who oversee the agent and approve high-risk actions.
*   **Platform Engineers:** Responsible for infrastructure, security policies (OPA), and sandbox environments.
*   **Security/Compliance Officers:** Review audit logs and safety evaluations to ensure regulatory compliance.

## 5. Functional Requirements (IEEE 830 SRS Compliant)

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

## 6. Non-Functional Requirements (IEEE 830 SRS Compliant)

| Req ID | Title | Description | Measurable Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **NFR-001** | High Availability | Ensure the command center engine remains highly available. | 99.9% uptime of API endpoints under a simulated load of up to 10k rps. |
| **NFR-002** | Security Gateway | Protect backend execution endpoints from arbitrary injections. | Zero vulnerabilities on OWASP Top 10 API Security tests. |
| **NFR-003** | Data Security | Secure persistent metrics, credentials, and data store records. | Encrypt all data-at-rest with AES-256 and data-in-transit with TLS 1.3. |
| **NFR-004** | Auditability | Record history of all diagnostic summaries, proposed actions, and user approvals. | Log 100% of transactions to the immutable Mastra storage log. |

## 7. Requirements Traceability Matrix (RTM)

This matrix maps functional and non-functional requirements directly to Mastra agents, workflows, and memory collections:

| Req ID | Component Type | Target Component | Status / Coverage |
| :--- | :--- | :--- | :--- |
| **FR-001** | API Route | `/api/incidents` | Covered / Implemented |
| **FR-002** | Tools | `logTool`, `metricsTool` | Covered / Implemented |
| **FR-003** | Mastra Agent | `diagnosisAgent` (via `diagnosisPrompt`) | Covered / Implemented |
| **FR-004** | Mastra Agent | `planningAgent` (via `planningPrompt`) | Covered / Implemented |
| **FR-005** | Workflow Step | `coordinatorStep` / Decision Gateway | Covered / Implemented |
| **FR-006** | Mastra Agent | `executionAgent` | Covered / Implemented |
| **FR-007** | Mastra Agent | `verificationAgent` | Covered / Implemented |
| **FR-008** | Workflow Step | `verificationStep` Rollback Engine | Covered / Implemented |
| **NFR-001** | Infrastructure | Next.js API Routes | Covered / Implemented |
| **NFR-002** | API Gateway | Kong API Gateway + Enkrypt AI Proxy | Covered / Documented |
| **NFR-003** | Storage / Network | LibSQL Store (AES-256) / TLS 1.3 Paths | Covered / Documented |
| **NFR-004** | Storage / memory | Qdrant Memory Collections | Covered / Implemented |

## 8. System Architecture Overview
The architecture is organized into six functional layers:
1.  **Ingestion & Messaging Mesh:** API Gateway (Kong) and Event Mesh (NATS/Kafka) ingest alerts from PagerDuty/Sentry.
2.  **Mastra Multi-Agent Core:** Specialized agents (Coordinator, Planning, Diagnosis, etc.) handle the logic and retrieval.
3.  **Governance, Decision Gateway & AI Safety Layer:** The central hub where Enkrypt AI, OPA, and the Decision Gateway enforce safety and risk-based routing.
4.  **Secure Execution Layer:** E2B Sandboxes execute commands in isolated Firecracker MicroVMs.
5.  **Persistence & Secrets Management:** Qdrant (Vector), PostgreSQL (State/Audit), and HashiCorp Vault (Secrets).
6.  **Infrastructure & Observability Stack:** LLM Gateway (Portkey/LiteLLM) and OTel stack (Prometheus, Grafana, Jaeger).

## 9. Tech Stack
*   **Orchestration:** Mastra SDK, Node.js, TypeScript, LangGraph.
*   **Memory:** Qdrant (Vector DB), HNSW Indexing.
*   **Safety & Policy:** Enkrypt AI Proxy, Dynamic OPA Engine, GitOps Policy Sync.
*   **Execution:** E2B Sandboxes (Firecracker MicroVMs).
*   **Messaging:** NATS, Kafka (including DLQ).
*   **Database:** PostgreSQL (Prisma ORM), Redis (for Kill Switch state).
*   **LLM Management:** Portkey, LiteLLM (LLM Gateway).
*   **Observability:** OpenTelemetry, Prometheus, Grafana, Jaeger.
*   **Security:** HashiCorp Vault, Kong API Gateway (OAuth2).

## 10. Data Requirements
### 10.1 Qdrant Collection Schema
*   `repo_architecture`: System design and dependency maps.
*   `historical_runbooks`: Standard operating procedures.
*   `incident_postmortems`: Past failures and resolutions.
*   `policy_metadata`: Audit trails of policy evaluations for continuous improvement.

### 10.2 Explainability Manifest
Every Decision Gateway evaluation produces an immutable audit record containing:
*   `IncidentID`, `TraceID`, `AgentID`.
*   `Confidence Score` & `Risk Classification`.
*   `Enkrypt AI Result` & `OPA Decision`.
*   `Final Routing Decision` & `Human Approval Status`.

## 11. Human Approval Matrix

| Operation | Risk Level | Autonomous | HITL Required | Execution Policy |
| :--- | :--- | :--- | :--- | :--- |
| Read Logs / Metrics | Low | Yes | No | Allow |
| Search Qdrant | Low | Yes | No | Allow |
| Restart K8s Pod | Medium | No | Yes (Slack) | Allow |
| Restart Redis | Medium | No | Yes (Slack) | Allow |
| Rollback Deployment | High | No | Yes (Senior) | Allow |
| Update Config | High | No | Yes (Senior) | Allow |
| DB Migration | Critical | No | Blocked | Manual Escalation |
| Resource Deletion | Critical | No | Blocked | Manual Escalation |

## 12. Security Requirements
*   **Defense-in-Depth Pipeline:** Planning -> Enkrypt AI -> OPA -> **Decision Gateway** -> HITL -> Sandbox.
*   **Decision Gateway Checkpoint:** Acts as the final governance gate; prevents execution even if upstream agents fail or are compromised.
*   **Dynamic Policy Governance:** OPA policies are version-controlled via GitOps and audited for compliance.
*   **Secrets Management:** Just-in-time (JIT) token injection via HashiCorp Vault.

## 13. Deployment & Infrastructure
*   **Platform:** Kubernetes (EKS/GKE).
*   **Operational Modes:**
    *   **Shadow Mode:** AI recommends; humans execute manually.
    *   **Approval Mode:** AI generates plans; humans approve; AI executes.
    *   **Autonomous Mode:** Low-risk actions execute automatically; others require approval.

## 14. Success Metrics
*   **MTTR Reduction:** Target 50% reduction in mean time to resolution.
*   **Safety Compliance:** 0 unauthorized production mutations.
*   **HITL Efficiency:** % of AI plans approved without modification.
*   **Policy Adaptability:** Time to deploy a new global safety policy across all agents.

## 15. Timeline & Milestones
*   **Phase 1:** Event Mesh ingestion and Mastra State Machine setup.
*   **Phase 2:** Qdrant memory integration and Diagnosis Agent tuning.
*   **Phase 3:** **Decision Gateway** and Governance Layer implementation (Enkrypt AI, OPA).
*   **Phase 4:** E2B Sandbox integration and Rollback Engine testing.
*   **Phase 5:** Shadow Mode deployment and HITL interface validation.

## 16. Open Questions & Risks
*   **LLM Hallucination:** Mitigated by Enkrypt AI and OPA, but requires continuous prompt versioning in the LLM Gateway.
*   **Latency:** Ensuring the safety pipeline (Enkrypt + OPA + Decision Gateway) adds minimal overhead to the incident response time.
*   **Policy Drift:** Ensuring GitOps-synced OPA policies remain consistent across distributed agent nodes.
