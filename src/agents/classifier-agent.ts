import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { classifierPrompt } from "../prompts/classifier-prompt";

export const classifierAgent = new Agent({
    id: "classifier-agent",
    name: "Incident Classifier",
    description:
        "Fast triage classifier — categorizes raw incident reports into a closed set of failure categories before diagnosis.",
    instructions: classifierPrompt,
    model: process.env.OPENAI_API_KEY
        ? "openai/gpt-4o-mini"
        : "google/gemini-2.5-flash",
    memory: new Memory(),
});
