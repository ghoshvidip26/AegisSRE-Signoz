import { register } from "./registry";
import type { Runbook } from "./types";

const NVM_INIT = `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"`;

/**
 * Pulls "current" and "required" Node versions straight out of the
 * diagnosis text (rootCause + recommendation). This runbook has no
 * reference to the reporting project's directory or its own .nvmrc — the
 * diagnosis text is the only real signal about what versions are involved.
 * Handles phrasing like "Current Node v20 ... requires Node 22",
 * "requires Node.js >=22", "needs node 22", etc. Major-version only —
 * good enough to pick an nvm-installable version.
 */
function extractVersions(text: string): { current: string | null; required: string | null } {
    const currentMatch = text.match(/current[^0-9]{0,20}v?(\d+)/i);
    const requiredMatch = text.match(/(?:require|need)[a-z]*[^0-9]{0,20}v?(\d+)/i);
    return {
        current: currentMatch?.[1] ?? null,
        required: requiredMatch?.[1] ?? null,
    };
}

export const nodeVersionRunbook: Runbook = {
    id: "node-version",
    description: "Mismatch in node version. Ex: some project requires node 22 but our system has currently 20.",
    riskTier: "medium",
    match(diagnosis) {
        const text = `${diagnosis.rootCause} ${diagnosis.recommendation}`.toLowerCase();
        const service = diagnosis.affectedService.toLowerCase();

        const isNodeVersionMismatch = service.includes("node") || text.includes("node") || text.includes("npm");
        const isEngineIssue = text.includes("ebadengine");
        if (isNodeVersionMismatch && isEngineIssue) {
            return { confidence: 0.9, reason: "Node version mismatch (EBADENGINE)" };
        }
        if (isNodeVersionMismatch) {
            return { confidence: 0.6, reason: "Node version mismatch related diagnosis, no specific failure signal" };
        }
        return { confidence: 0, reason: "No node version mismatch signal in diagnosis" };
    },
    async execute(diagnosis, { executor }) {
        const text = `${diagnosis.rootCause} ${diagnosis.recommendation}`;
        const { current, required } = extractVersions(text);

        if (!required) {
            return {
                status: "failed",
                summary: "Could not determine the required Node version from the diagnosis text.",
                steps: [],
            };
        }

        if (current === required) {
            return {
                status: "success",
                summary: `Diagnosis indicates Node ${required} is already the required version — nothing to change.`,
                steps: [],
                telemetry: { node: { currentVersion: current, requiredVersion: required, status: "matched" } },
            };
        }

        // nvm alias default persists to ~/.nvm/alias/default — any fresh
        // shell that sources nvm.sh picks it up, regardless of what
        // environment the calling process itself inherited. That's the
        // difference between this actually fixing something and `nvm use`,
        // which only affects one disposable subshell.
        //
        // Downloading + installing a Node version can take well over the
        // executor's default 10s timeout, especially for a version that
        // isn't already cached — give it real headroom instead of letting
        // it get killed mid-download and silently reported as a timeout
        // failure.
        const install = await executor.run(`${NVM_INIT} && nvm install ${required}`, {
            timeoutMs: 120_000,
            label: `nvm install ${required}`,
        });
        const setDefault = await executor.run(`${NVM_INIT} && nvm alias default ${required}`, {
            label: `nvm alias default ${required}`,
        });

        // Both must succeed: `nvm alias default` can "succeed" against a
        // stale, unrelated version that already happens to satisfy the
        // major-version alias even when the actual install just failed —
        // that's a false positive, not a real fix.
        const success = install.ok && setDefault.ok;

        return {
            status: success ? "success" : "failed",
            summary: success
                ? `Installed Node ${required} and set it as the default version (was ${current ?? "unknown"}).`
                : !install.ok
                    ? `Failed to install Node ${required} — see stderr for details.`
                    : "Unable to set the new default Node version — see stderr for details.",
            steps: [
                { command: `nvm install ${required}`, result: install },
                { command: `nvm alias default ${required}`, result: setDefault },
            ],
            telemetry: {
                node: {
                    currentVersion: current,
                    requiredVersion: required,
                    status: success ? "fixing" : "mismatch",
                },
            },
        };
    },
    async verify(diagnosis, { executor }) {
        const text = `${diagnosis.rootCause} ${diagnosis.recommendation}`;
        const { required } = extractVersions(text);

        // Fresh-source nvm.sh in a brand-new shell — this recomputes PATH
        // from the persistent default alias, not from any inherited
        // environment, so it correctly reflects nvm alias default even
        // though the process running this runbook never itself switched.
        const active = await executor.run(`${NVM_INIT} && node -v`);
        const activeVersion = active.stdout?.trim().replace(/^v/, "").split(".")[0];

        const evidence = [
            `node -v (fresh shell) → ${active.stdout?.trim() ?? "(no output)"}`,
            `required major version → ${required ?? "unknown"}`,
        ];

        const telemetry = {
            node: {
                currentVersion: activeVersion ?? null,
                requiredVersion: required,
                status: required && activeVersion === required ? "resolved" : "mismatch",
            },
        };

        if (required && active.ok && activeVersion === required) {
            return { resolved: true, evidence, telemetry };
        }
        return { resolved: false, evidence, telemetry };
    },
};

register(nodeVersionRunbook);
