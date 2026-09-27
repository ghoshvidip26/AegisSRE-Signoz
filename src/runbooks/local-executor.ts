import { exec } from "node:child_process";
import { promisify } from "node:util";
import { checkFirewallPolicy } from "@/src/services/firewall-client";
import type { Executor } from "./types";

const execAsync = promisify(exec);

export const localShellExecutor: Executor = {
    async run(command, opts) {
        const firewall = await checkFirewallPolicy(command);
        if (firewall) {
            console.log(
                `[firewall] ${firewall.decision} "${command}" (${firewall.severity}, score=${firewall.risk_score}) — ${firewall.reason}`
            );
        }
        if (firewall?.decision === "BLOCK") {
            return {
                ok: false,
                stderr: `Blocked by Aegis-Firewall: ${firewall.reason} (severity: ${firewall.severity})`,
            };
        }

        try {
            const { stdout, stderr } = await execAsync(command, {
                timeout: opts?.timeoutMs ?? 10_000,
            });
            return { ok: true, stdout, stderr };
        } catch (err: unknown) {
            const e = err as { stdout?: string; stderr?: string; message?: string };
            return {
                ok: false,
                stdout: e.stdout,
                stderr: e.stderr ?? e.message ?? "unknown error",
            };
        }
    },
};