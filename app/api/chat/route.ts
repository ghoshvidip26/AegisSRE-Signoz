import { handleChatStream } from '@mastra/ai-sdk'
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui'
import { createUIMessageStreamResponse } from 'ai'
import { mastra } from '@/src/mastra'
import { NextResponse } from 'next/server'
import { incidentStore } from '@/lib/incidents/incident-store'
import { tracer } from '@/lib/tracing'
import { SpanStatusCode } from '@opentelemetry/api'

const DEFAULT_THREAD_ID = 'aegis-sre-general'
const RESOURCE_ID = 'incident-chat'
type UIMessageStreamResponseOptions = Parameters<typeof createUIMessageStreamResponse>[0]

export async function POST(req: Request) {
    return tracer.startActiveSpan("Handle Incident", async (span) => {
        try {
            const params = await req.json()

            const url = new URL(req.url)
            const incidentId = url.searchParams.get('incidentId')
            span.setAttribute("incident.id", incidentId ?? "general");
            // Each incident gets its own thread — separate chat history per incident
            const threadId = incidentId ?? DEFAULT_THREAD_ID
            span.setAttribute("thread.id", threadId);
            // Build incident context to inject into the conversation
            let incidentContext = ''
            if (incidentId) {
                const incident = incidentStore.get(incidentId)
                if (incident) {
                    incidentContext = `
[ACTIVE INCIDENT CONTEXT]
You are currently investigating incident ${incident.id}.
- Service: ${incident.service}
- Severity: ${incident.severity ?? 'Unknown'}
- Title: ${incident.title}
- Message: ${incident.message}
- Status: ${incident.status}
- Created: ${incident.createdAt}

When using the log-tool, use incidentId "${incident.id}".
When using the metrics-tool, use service "${incident.service}".
Always reference this incident in your responses.
[END INCIDENT CONTEXT]
`
                }
            }
            span.setAttribute(
                "has.incident.context",
                Boolean(incidentContext)
            );
            span.setAttribute("agent.id", "coordinator-agent");

            const stream = await handleChatStream({
                mastra,
                agentId: 'coordinator-agent',
                params: {
                    ...params,
                    ...(incidentContext && {
                        instructions: incidentContext,
                    }),
                    memory: {
                        ...params.memory,
                        thread: threadId,
                        resource: RESOURCE_ID,
                    },
                },
            })
            return createUIMessageStreamResponse({
                stream: stream as unknown as UIMessageStreamResponseOptions['stream'],
            })
        }
        catch (err) {
            span.recordException(err as Error);

            span.setStatus({
                code: SpanStatusCode.ERROR
            });

            throw err;
        }
        finally {
            span.end();
        }
    })
}

export async function GET(req: Request) {
    const url = new URL(req.url)
    const incidentId = url.searchParams.get('incidentId')
    const threadId = incidentId ?? DEFAULT_THREAD_ID

    const memory = await mastra.getAgentById('coordinator-agent').getMemory()
    let response = null

    try {
        response = await memory?.recall({
            threadId,
            resourceId: RESOURCE_ID,
        })
    } catch {
        // No previous messages for this thread
    }

    const uiMessages = toAISdkV5Messages(response?.messages || [])

    return NextResponse.json(uiMessages)
}

export async function DELETE() {
    const memory = await mastra.getAgentById('coordinator-agent').getMemory()
    try {
        if (memory) {
            const response = await memory.recall({
                threadId: DEFAULT_THREAD_ID,
                resourceId: RESOURCE_ID,
            })
            const messageIds = (response?.messages || []).map((msg: any) => msg.id)
            if (messageIds.length > 0) {
                await memory.deleteMessages(messageIds)
            }
        }
    } catch (e) {
        console.error('Failed to clear Mastra memory:', e)
    }

    const { incidentStore } = await import('@/lib/incidents/incident-store')
    incidentStore.clear()

    return NextResponse.json({ success: true })
}
