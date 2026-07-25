'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { UIMessage } from 'ai'

export type MetricsData = {
  cpu: number
  memory: number
  errorRate: number
  latency: number
}

export type LogEntry = {
  timestamp: string
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
  message: string
  step?: string
}

export type WorkflowStepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed'

export type WorkflowState = {
  coordinator: WorkflowStepStatus
  classify: WorkflowStepStatus
  diagnose: WorkflowStepStatus
  plan: WorkflowStepStatus
  approval: WorkflowStepStatus
  execute: WorkflowStepStatus
  verify: WorkflowStepStatus
}

export type ApproveResult = { success: boolean; error?: string }

export type IncidentContextValue = {
  metrics: MetricsData | null
  logs: LogEntry[]
  workflowState: WorkflowState
  activeIncident: {
    id: string
    title: string
    severity: string
    status: string
    runbookId?: string | null
    riskTier?: string
    approvalReason?: string
    trace?: { traceId: string; spanId?: string } | null
  } | null
  approveIncident: (approved: boolean, reason?: string) => Promise<ApproveResult>
}

const defaultWorkflowState: WorkflowState = {
  coordinator: 'pending',
  classify: 'pending',
  diagnose: 'pending',
  plan: 'pending',
  approval: 'pending',
  execute: 'pending',
  verify: 'pending',
}

const IncidentContext = createContext<IncidentContextValue>({
  metrics: null,
  logs: [],
  workflowState: defaultWorkflowState,
  activeIncident: null,
  approveIncident: async () => ({ success: false, error: 'Not initialized' }),
})

export function useIncidentContext() {
  return useContext(IncidentContext)
}

export function IncidentContextProvider({
  messages,
  selectedIncidentId,
  children,
}: {
  messages: UIMessage[]
  selectedIncidentId: string | null
  children: React.ReactNode
}) {
  const [pipelineState, setPipelineState] = useState<WorkflowState>(defaultWorkflowState)
  const [activeIncident, setActiveIncident] = useState<IncidentContextValue['activeIncident']>(null)
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])

  const pollIncidentStatus = useCallback(async () => {
    console.log("Selected Incident:", selectedIncidentId);
    if (!selectedIncidentId) {
      setPipelineState(defaultWorkflowState)
      setActiveIncident(null)
      setMetrics(null)
      setLogs([])
      return
    }

    try {
      const res = await fetch(`/api/incidents/${selectedIncidentId}`)
      if (!res.ok) return

      const data = await res.json()
      console.log("Incident API Response:", data);
      if (data.pipeline) {
        setPipelineState(data.pipeline)
      }
      if (data.incident) {
        setActiveIncident({
          id: data.incident.id,
          title: data.incident.title,
          severity: data.incident.severity ?? 'Unknown',
          status: data.incident.status,
          runbookId: data.incident.runbookId ?? null,
          riskTier: data.incident.riskTier,
          approvalReason: data.incident.approvalReason,
          trace: data.incident.trace ?? null,
        })
      }
      if (data.metrics) {
        setMetrics({
          cpu: data.metrics.cpu ?? 0,
          memory: data.metrics.memory ?? 0,
          errorRate: data.metrics.errorRate ?? 0,
          latency: data.metrics.latency ?? 0,
        })
      }
      if (data.operationsLog && data.operationsLog.length > 0) {
        type Operation = {
          step: string
          title: string
          status: 'running' | 'completed' | 'failed' | 'waiting'
          timestamp: number
          details?: string
        }
        const levelFor = (status: Operation['status']): LogEntry['level'] =>
          status === 'failed' ? 'ERROR' : status === 'waiting' ? 'WARN' : 'INFO'

        const entries: LogEntry[] = (data.operationsLog as Operation[]).map((op) => ({
          timestamp: new Date(op.timestamp).toLocaleTimeString('en-US', { hour12: false }),
          level: levelFor(op.status),
          message: op.details ? `${op.title} — ${op.details}` : op.title,
          step: op.step,
        }))
        setLogs(entries)
      }
    } catch {
      // Will retry on next poll
    }
  }, [selectedIncidentId])

  useEffect(() => {
    pollIncidentStatus()
    const interval = setInterval(pollIncidentStatus, 2000)
    return () => clearInterval(interval)
  }, [pollIncidentStatus])

  const approveIncident = useCallback(
    async (approved: boolean, reason?: string): Promise<ApproveResult> => {
      if (!selectedIncidentId) {
        return { success: false, error: 'No incident selected' }
      }
      try {
        const res = await fetch(`/api/incidents/${selectedIncidentId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved, reason }),
        })
        const data = await res.json()
        if (!res.ok) {
          return { success: false, error: data.error ?? `Request failed (${res.status})` }
        }
        await pollIncidentStatus()
        return { success: true }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Network error' }
      }
    },
    [selectedIncidentId, pollIncidentStatus]
  )

  const contextValue: IncidentContextValue = {
    metrics,
    logs,
    workflowState: pipelineState,
    activeIncident,
    approveIncident,
  }

  return (
    <IncidentContext.Provider value={contextValue}>
      {children}
    </IncidentContext.Provider>
  )
}
