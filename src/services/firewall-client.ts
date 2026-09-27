import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Aegis-Firewall (JevGuard) is a separate Python project that screens
 * commands/actions for genuinely dangerous operations — credential access
 * (.env, id_rsa), secrets pushed to GitHub, destructive filesystem deletes,
 * privilege escalation, reverse shells. It is NOT meant to gate AegisSRE's
 * own pre-vetted runbook automation (redis-cli, redis-server, git fetch —
 * see Aegis-Firewall's core/shell_risk.py, which whitelists these as
 * low-risk specifically so this integration doesn't block them).
 *
 * Connected once via stdio and reused for the process lifetime — each check
 * after the first is just a JSON-RPC round trip over the already-running
 * `python3 mcp_server.py` child process, not a fresh spawn.
 */
let clientPromise: Promise<Client> | null = null;

function getClient(): Promise<Client> {
    if (clientPromise) return clientPromise;

    clientPromise = (async () => {
        const scriptPath = process.env.AEGIS_FIREWALL_MCP_PATH;
        if (!scriptPath) {
            throw new Error("AEGIS_FIREWALL_MCP_PATH is not set");
        }

        const transport = new StdioClientTransport({
            command: process.env.AEGIS_FIREWALL_PYTHON || "python3",
            args: [scriptPath],
            // Aegis-Firewall's own modules (e.g. core/policy_engine.py) open
            // config files by a path relative to its own directory — without
            // this the child inherits AegisSRE's cwd and crashes on import.
            cwd: dirname(scriptPath),
        });

        const client = new Client({ name: "aegis-sre", version: "1.0.0" }, { capabilities: {} });
        await client.connect(transport);
        return client;
    })();

    // Don't cache a rejected connection attempt — let the next call retry
    // (e.g. the firewall process wasn't up yet on the first check).
    clientPromise.catch(() => {
        clientPromise = null;
    });

    return clientPromise;
}

/**
 * Closes the underlying connection, if one was opened. AegisSRE itself never
 * needs this — the server process just keeps the connection open — but a
 * short-lived script (see scripts/test-firewall.ts) should call this before
 * exiting so the Python child gets a clean shutdown instead of a pipe
 * slammed shut mid-write.
 */
export async function closeFirewallClient(): Promise<void> {
    if (!clientPromise) return;
    const client = await clientPromise.catch(() => null);
    clientPromise = null;
    await client?.close();
}

export type FirewallDecision = "ALLOW" | "PENDING" | "BLOCK";

export type FirewallCheckResult = {
    query: string;
    tool: string;
    decision: FirewallDecision;
    risk_score: number;
    severity: string;
    reason: string;
};

/**
 * Checks a command/action against Aegis-Firewall before it runs. Returns
 * `null` when the firewall is unreachable or misconfigured (matching
 * jev-client.ts's fail-open convention) — callers should log a warning and
 * proceed rather than blocking the whole SRE pipeline on a sidecar being
 * down for an unrelated reason.
 */
export async function checkFirewallPolicy(query: string): Promise<FirewallCheckResult | null> {
    try {
        const client = await getClient();
        const response = await client.callTool({
            name: "check_firewall_policy",
            arguments: { query },
        });

        const content = response.content as Array<{ type: string; text?: string }>;
        const text = content?.[0]?.text;
        if (!text) throw new Error("Empty response from check_firewall_policy");

        return JSON.parse(text) as FirewallCheckResult;
    } catch (err) {
        console.warn(
            "[firewall-client] check_firewall_policy failed, allowing through (fail-open):",
            err instanceof Error ? err.message : err
        );
        return null;
    }
}
