'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Zap,
  Cpu,
  Activity,
  ShieldCheck,
  TrendingUp,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TraceCard, type TraceSummary } from '@/components/incident-details/trace-card'
import { WorkflowStages, FirewallBadge, type IncidentOperation } from '@/components/incident-details/workflow-stages'
import { VerificationChecklist } from '@/components/incident-details/verification-checklist'

type Incident = {
  id: string
  service: string
  message: string
  title?: string
  severity?: string
  status: string
  category?: string
  classifierService?: string
  classifierConfidence?: number
  rootCause?: string
  affectedService?: string
  recommendation?: string
  runbookId?: string
  riskTier?: string
  approvalReason?: string
  plan?: string
  createdAt: string
  resolvedAt?: number
  failureReason?: string
  trace?: { traceId: string; spanId?: string }
  telemetry?: Record<string, unknown>
  operationsLog?: IncidentOperation[]
}

const TERMINAL_STATUSES = ['RESOLVED', 'FAILED', 'AWAITING_REVIEW']

export default function IncidentDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [incident, setIncident] = useState<Incident | null>(null)
  const [trace, setTrace] = useState<TraceSummary | null>(null)
  const [signozUrl, setSignozUrl] = useState<string | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/incidents/${id}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled) setIncident(data.incident)
      } catch {
        // retry on next poll
      }
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [id])

  useEffect(() => {
    if (!incident?.trace?.traceId) return
    let cancelled = false
    const fetchTrace = async () => {
      setTraceLoading(true)
      try {
        const res = await fetch(`/api/incidents/${id}/trace`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled) {
          setTrace(data.trace)
          setSignozUrl(data.signozUrl)
        }
      } finally {
        if (!cancelled) setTraceLoading(false)
      }
    }
    fetchTrace()
    // Re-fetch once the incident reaches a terminal state — the trace is
    // only fully indexed in SigNoz once the whole workflow (and every span
    // in it) has finished.
  }, [id, incident?.trace?.traceId, incident?.status])

  if (!incident) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading incident...
      </div>
    )
  }

  const operationsLog = incident.operationsLog ?? []
  const isTerminal = TERMINAL_STATUSES.includes(incident.status)
  const incidentDurationMs = incident.resolvedAt
    ? incident.resolvedAt - new Date(incident.createdAt).getTime()
    : isTerminal
      ? undefined
      : Date.now() - new Date(incident.createdAt).getTime()

  const verifyOps = operationsLog.filter((op) => op.step === 'verify')
  const verifyEvidence = verifyOps
    .map((op) => op.details)
    .filter((d): d is string => !!d)
    .flatMap((d) => d.split('; '))

  const executeOps = operationsLog.filter((op) => op.step === 'execute')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Link
            href="/"
            className="mt-0.5 shrink-0 rounded-lg border border-border/40 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-foreground truncate">
                {incident.title ?? incident.message}
              </h1>
              <StatusBadge status={incident.status} />
              {incident.severity && (
                <Badge variant="outline" className="text-[10px]">
                  {incident.severity}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {incident.id} · {incident.service}
            </p>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList variant="line" className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="observability">Observability</TabsTrigger>
            <TabsTrigger value="trace">Trace</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="workflow">Workflow</TabsTrigger>
            <TabsTrigger value="runbook">Runbook</TabsTrigger>
            <TabsTrigger value="verification">Verification</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
                  Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FieldRow label="Service" value={incident.service} />
                <FieldRow label="Category" value={incident.category ?? '—'} />
                {incident.classifierConfidence !== undefined && (
                  <FieldRow
                    label="Classifier confidence"
                    value={`${Math.round(incident.classifierConfidence * 100)}%`}
                  />
                )}
                {incident.rootCause && <FieldRow label="Root cause" value={incident.rootCause} multiline />}
                {incident.recommendation && (
                  <FieldRow label="Recommendation" value={incident.recommendation} multiline />
                )}
                {incident.failureReason && (
                  <FieldRow label="Failure reason" value={incident.failureReason} multiline danger />
                )}
              </CardContent>
            </Card>
            <TraceCard traceId={incident.trace?.traceId} trace={trace} signozUrl={signozUrl} loading={traceLoading} compact />
          </TabsContent>

          {/* Observability */}
          <TabsContent value="observability" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
                  Pipeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ObservabilityPipeline incident={incident} operationsLog={operationsLog} />
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Trace ID" value={incident.trace?.traceId ? `${incident.trace.traceId.slice(0, 8)}...` : '—'} mono />
              <StatCard label="Span Count" value={trace ? String(trace.spanCount) : '—'} />
              <StatCard
                label="Workflow Duration"
                value={incidentDurationMs !== undefined ? formatDuration(incidentDurationMs) : '—'}
              />
              <StatCard label="Incident Duration" value={incidentDurationMs !== undefined ? formatDuration(incidentDurationMs) : '—'} />
            </div>
          </TabsContent>

          {/* Trace */}
          <TabsContent value="trace" className="mt-4">
            <TraceCard traceId={incident.trace?.traceId} trace={trace} signozUrl={signozUrl} loading={traceLoading} />
          </TabsContent>

          {/* Timeline */}
          <TabsContent value="timeline" className="mt-4">
            <OperationsTimeline operationsLog={operationsLog} />
          </TabsContent>

          {/* Workflow */}
          <TabsContent value="workflow" className="mt-4">
            <WorkflowStages operationsLog={operationsLog} />
          </TabsContent>

          {/* Runbook */}
          <TabsContent value="runbook" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
                  Selected Runbook
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FieldRow label="Runbook" value={incident.runbookId ?? 'None matched'} mono={!!incident.runbookId} />
                {incident.riskTier && <FieldRow label="Risk tier" value={incident.riskTier} />}
                {incident.plan && <FieldRow label="Plan" value={incident.plan} multiline />}
                {incident.approvalReason && (
                  <FieldRow label="Approval reason" value={incident.approvalReason} multiline />
                )}
              </CardContent>
            </Card>
            {executeOps.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">
                    Executed Commands
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {executeOps.map((op) => (
                    <div
                      key={op.id}
                      className={`rounded-lg border px-3 py-2 font-mono text-[11px] ${
                        op.status === 'failed' ? 'border-destructive/30 bg-destructive/5' : 'border-border/40 bg-card/20'
                      }`}
                    >
                      <span className={op.status === 'failed' ? 'text-destructive font-bold' : 'text-secondary font-bold'}>
                        {op.status === 'failed' ? '✗' : '✓'}
                      </span>{' '}
                      {op.title}
                      {op.details && <p className="mt-1 text-muted-foreground break-words">{op.details}</p>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Verification */}
          <TabsContent value="verification" className="mt-4">
            <VerificationChecklist
              evidence={verifyEvidence}
              resolved={incident.status === 'RESOLVED'}
              hasTrace={!!incident.trace?.traceId}
              status={incident.status}
            />
          </TabsContent>

          {/* Logs */}
          <TabsContent value="logs" className="mt-4">
            <OperationsTimeline operationsLog={operationsLog} dense />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    RESOLVED: 'bg-secondary/10 text-secondary border-secondary/30',
    FAILED: 'bg-destructive/10 text-destructive border-destructive/30',
    AWAITING_REVIEW: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    AWAITING_APPROVAL: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  }
  const cls = map[status] ?? 'bg-primary/10 text-primary border-primary/30'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function FieldRow({
  label,
  value,
  multiline,
  mono,
  danger,
}: {
  label: string
  value: string
  multiline?: boolean
  mono?: boolean
  danger?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-sm ${mono ? 'font-mono' : ''} ${danger ? 'text-destructive' : 'text-foreground'} ${
          multiline ? 'leading-relaxed' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function StatCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/20 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-bold text-foreground ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

function ObservabilityPipeline({
  incident,
  operationsLog,
}: {
  incident: Incident
  operationsLog: IncidentOperation[]
}) {
  const steps = [
    { label: 'SigNoz collected telemetry', done: !!incident.trace?.traceId, icon: Zap },
    { label: 'Aegis correlated telemetry', done: !!incident.category, icon: Cpu },
    { label: 'AI diagnosed the issue', done: !!incident.rootCause, icon: Activity },
    {
      label: 'Runbook executed',
      done: operationsLog.some((op) => op.step === 'execute' && op.status !== 'running'),
      icon: TrendingUp,
    },
    {
      label: 'Verification completed',
      done: operationsLog.some((op) => op.step === 'verify' && op.status !== 'running'),
      icon: CheckCircle2,
    },
  ]

  return (
    <div className="flex flex-col gap-0">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                step.done ? 'border-secondary bg-secondary/10 text-secondary' : 'border-border/40 bg-card/30 text-muted-foreground/50'
              }`}
            >
              <step.icon className="h-3.5 w-3.5" />
            </div>
            {i < steps.length - 1 && (
              <div className={`w-px flex-1 min-h-4 ${step.done ? 'bg-secondary/40' : 'bg-border/40'}`} />
            )}
          </div>
          <p className={`pb-4 pt-1 text-xs font-medium ${step.done ? 'text-foreground' : 'text-muted-foreground'}`}>
            {step.label}
          </p>
        </div>
      ))}
    </div>
  )
}

const stepIcon: Record<string, typeof Zap> = {
  coordinator: Zap,
  classify: Cpu,
  diagnose: Activity,
  planning: ShieldCheck,
  approval: Clock,
  execute: TrendingUp,
  verify: CheckCircle2,
}

function OperationsTimeline({ operationsLog, dense }: { operationsLog: IncidentOperation[]; dense?: boolean }) {
  if (operationsLog.length === 0) {
    return <p className="text-xs text-muted-foreground">No operations recorded yet.</p>
  }

  const levelBorder: Record<string, string> = {
    failed: 'border-destructive/60',
    waiting: 'border-amber-500/60',
    completed: 'border-secondary/40',
    running: 'border-primary/40',
  }

  return (
    <div className={dense ? 'space-y-1.5 font-mono text-[11px]' : 'space-y-2.5'}>
      {operationsLog.map((op) => {
        const Icon = stepIcon[op.step] ?? Activity
        return (
          <div key={op.id} className={`border-l-2 pl-3 py-1 ${levelBorder[op.status] ?? 'border-border/40'}`}>
            <div className="flex items-center gap-2 flex-wrap">
              {!dense && <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              <span className="text-[10px] text-secondary font-medium">
                {new Date(op.timestamp).toLocaleTimeString('en-US', { hour12: false })}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">{op.step}</span>
              {op.duration !== undefined && (
                <span className="text-[9px] text-muted-foreground/70 font-mono">
                  ({op.duration < 1000 ? `${op.duration}ms` : `${(op.duration / 1000).toFixed(1)}s`})
                </span>
              )}
              {op.firewall && <FirewallBadge firewall={op.firewall} />}
            </div>
            <p className={`mt-0.5 ${dense ? '' : 'text-sm'} text-foreground/90 break-words`}>{op.title}</p>
            {op.details && !dense && (
              <p className="mt-0.5 text-xs text-muted-foreground break-words">{op.details}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}
