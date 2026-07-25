import { mastra } from './src/mastra';
import fs from 'fs';

async function main() {
    try {
        const workflow = mastra.getWorkflow("incidentWorkflow");
        const run = await workflow.createRun();
        const result = await run.start({
            inputData: {
                incidentDescription: "Title: Test Incident\nMessage: Connection refused.",
                incidentId: "INC-TEST",
                service: "Test Service"
            }
        });
        fs.writeFileSync("output.json", JSON.stringify(result, null, 2));
    } catch (e: any) {
        fs.writeFileSync("error.json", JSON.stringify({
            message: e.message,
            stack: e.stack,
            name: e.name
        }, null, 2));
    }
}

main();
