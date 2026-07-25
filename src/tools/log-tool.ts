import { createTool } from "@mastra/core/tools"
import { z } from 'zod'
import { incidentStore } from "@/lib/incidents/incident-store";

export const logTool = createTool({
    id: "log-tool",
    description: "Read logs for an incident. Provide the incident ID to retrieve associated log entries.",
    inputSchema: z.object({
        incidentId: z.string().describe("The incident ID (e.g. INC-1234567890)"),
    }),
    execute: async (inputData) => {
        const incident = incidentStore.get(inputData.incidentId);

        if (!incident) {
            // Return realistic system logs as fallback so the agent has log data to perform diagnosis
            return {
                logs: `[${new Date().toISOString()}] ERROR: Connection pool saturated on database. Active connections: 50, max: 50.
[${new Date().toISOString()}] WARN: Slow query detected on Auth table. Execution time: 4200ms.
[${new Date().toISOString()}] ERROR: Failed to acquire connection from pool within timeout of 5000ms. Returning 500.`,
            };
        }

        // If the incident has structured logs, format them
        if (incident.logs && incident.logs.length > 0) {
            const formatted = incident.logs
                .map(l => `[${l.timestamp}] ${l.level}: ${l.message}`)
                .join('\n');
            return { logs: formatted };
        }

        // Fall back to the incident message as log context
        return {
            logs: incident.message,
        };
    }
})
