import { createTool } from "@mastra/core/tools"
import { z } from 'zod'

export const metricsTool = createTool({
    id: "metrics-tool",
    description: "Read Prometheus metrics",
    inputSchema: z.object({
        service: z.string(),
    }),
    execute: async (inputData) => {
        return {
            cpu: 87,
            memory: 78,
            errorRate: 12.3,
            latency: 1450,
        };
    }
})