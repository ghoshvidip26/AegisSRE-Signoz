/**
 * Exercises the Aegis-Firewall MCP integration directly — no LLM calls, no
 * running incident required. Useful for checking the firewall itself is
 * reachable and behaving correctly, independent of whether the diagnosis
 * agent's LLM provider is up/rate-limited.
 *
 * Run: npm run test:firewall
 */
import { checkFirewallPolicy, closeFirewallClient } from "../src/services/firewall-client.ts";

const CASES: Array<{ query: string; expect: "ALLOW" | "BLOCK" }> = [
    { query: "redis-cli ping", expect: "ALLOW" },
    { query: "redis-server --daemonize yes", expect: "ALLOW" },
    { query: "git status", expect: "ALLOW" },
    { query: "cat .env", expect: "BLOCK" },
    { query: "rm -rf /", expect: "BLOCK" },
];

let failures = 0;

for (const { query, expect } of CASES) {
    const result = await checkFirewallPolicy(query);

    if (!result) {
        console.log(`\x1b[33m? UNREACHABLE\x1b[0m  "${query}" — firewall did not respond (check AEGIS_FIREWALL_MCP_PATH)`);
        failures++;
        continue;
    }

    const pass = result.decision === expect;
    if (!pass) failures++;

    const icon = pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(
        `${icon} ${result.decision.padEnd(7)} "${query}" — ${result.reason} (expected ${expect})`
    );
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed or unreachable.`);
await closeFirewallClient();
process.exit(failures === 0 ? 0 : 1);
