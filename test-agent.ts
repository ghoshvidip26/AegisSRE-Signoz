import 'dotenv/config';
import { mastra } from './src/mastra';

async function testAgent() {
    try {
        console.log("Testing agent directly...");
        const agent = mastra.getAgent("diagnosisAgent");
        const result = await agent.generate(
            `Analyze this incident and return JSON with rootCause, severity, confidence, affectedService, and recommendation:\n\nTitle: Test Incident\nMessage: Connection refused.`
        );
        console.log("Agent result:", result.text);
    } catch (e: any) {
        console.error("Agent error:", e);
    }
}

testAgent();
