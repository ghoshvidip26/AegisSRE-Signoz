import { register } from "./registry";
import type { Runbook } from "./types";

export const gitDivergedBranchRunbook: Runbook = {
    id: "git-branch",
    description: "Check for changes between remote and local.",
    riskTier: "medium",
    match(diagnosis) {
        const text = `${diagnosis.rootCause} ${diagnosis.recommendation}`.toLowerCase();
        const service = diagnosis.affectedService.toLowerCase();
        const isGit = service.includes("git") || text.includes("git");
        const isDiverged =
            text.includes("divergent branches") ||
            text.includes("need to specify how to reconcile") ||
            diagnosis.category === "git_diverged_branch";
        if (isGit && isDiverged) {
            return { confidence: 0.9, reason: "Git branch divergence detected" };
        }
        return { confidence: 0, reason: "No git branch divergence detected" };
    },
    async execute(_diagnosis, { executor }) {
        const fetch = await executor.run("git fetch");
        const status = await executor.run("git status");
        const branches = await executor.run("git branch -vv");
        const success = fetch.ok && status.ok && branches.ok;
        return {
            status: success ? "success" : "failed",
            summary: success
                ? "Repository status collected successfully."
                : "Unable to inspect repository state.",
            steps: [
                { command: "git fetch", result: fetch },
                { command: "git status", result: status },
                { command: "git branch -vv", result: branches },
            ],
        };
    },
    async verify(_diagnosis, { executor }) {
        const verify = await executor.run("git status");
        if (verify.ok) {
            return { resolved: true, evidence: [] };
        }
        return { resolved: false, evidence: [] };
    }
}

register(gitDivergedBranchRunbook);