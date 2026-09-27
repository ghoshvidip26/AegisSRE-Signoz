'use client'

import { CheckCircle2, Circle, Loader2, XCircle, Clock, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { groupStages, type Stage, type StageStatus } from '@/lib/incidents/workflow-stages'
import type { IncidentOperation } from '@/lib/incidents/incident'

export type { IncidentOperation }

export function WorkflowStages({ operationsLog }: { operationsLog: IncidentOperation[] }) {
  const stages = groupStages(operationsLog)

  return (
    <div className="space-y-2">
      {stages.map((stage) => (
        <StageRow key={stage.step} stage={stage} />
      ))}
    </div>
  )
}

function StageRow({ stage }: { stage: Stage }) {
  const gatedOps = stage.operations.filter((op) => op.firewall)

  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-colors ${
        stage.status === 'failed'
          ? 'border-destructive/30 bg-destructive/5'
          : stage.status === 'running'
            ? 'border-primary/30 bg-primary/5'
            : stage.status === 'waiting'
              ? 'border-amber-500/30 bg-amber-500/5'
              : stage.status === 'completed'
                ? 'border-secondary/30 bg-secondary/5'
                : 'border-border/40 bg-card/20 opacity-60'
      }`}
    >
      <div className="flex items-center gap-3">
        <StageIcon status={stage.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{stage.label}</p>
          {stage.startTime && (
            <p className="text-[10px] text-muted-foreground">
              {new Date(stage.startTime).toLocaleTimeString('en-US', { hour12: false })}
              {stage.endTime && stage.endTime !== stage.startTime && (
                <> → {new Date(stage.endTime).toLocaleTimeString('en-US', { hour12: false })}</>
              )}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <span
            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
              stage.status === 'failed'
                ? 'bg-destructive text-destructive-foreground'
                : stage.status === 'running'
                  ? 'bg-primary text-primary-foreground'
                  : stage.status === 'waiting'
                    ? 'bg-amber-500 text-white'
                    : stage.status === 'completed'
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-muted text-muted-foreground'
            }`}
          >
            {stage.status}
          </span>
          {stage.durationMs !== null && (
            <p className="mt-0.5 text-[10px] text-muted-foreground font-mono">
              {stage.durationMs < 1000 ? `${stage.durationMs}ms` : `${(stage.durationMs / 1000).toFixed(1)}s`}
            </p>
          )}
        </div>
      </div>

      {gatedOps.length > 0 && (
        <div className="ml-7 mt-2 space-y-1.5 border-l border-border/40 pl-3">
          {gatedOps.map((op) => (
            <FirewallOpRow key={op.id} op={op} />
          ))}
        </div>
      )}
    </div>
  )
}

function FirewallOpRow({ op }: { op: IncidentOperation }) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-0">
      <span className="truncate font-mono text-[11px] text-muted-foreground" title={op.title}>
        {op.title}
      </span>
      {op.firewall && <FirewallBadge firewall={op.firewall} />}
    </div>
  )
}

export function FirewallBadge({ firewall }: { firewall: NonNullable<IncidentOperation['firewall']> }) {
  const config = {
    ALLOW: {
      icon: ShieldCheck,
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    BLOCK: {
      icon: ShieldAlert,
      className: 'border-destructive/30 bg-destructive/10 text-destructive',
    },
    PENDING: {
      icon: ShieldQuestion,
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    },
  }[firewall.decision]
  const Icon = config.icon

  return (
    <span
      title={`${firewall.reason} (severity: ${firewall.severity}, score: ${firewall.riskScore})`}
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${config.className}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {firewall.decision}
    </span>
  )
}

function StageIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-secondary shrink-0" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-destructive shrink-0" />
    case 'running':
      return <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
    case 'waiting':
      return <Clock className="h-4 w-4 text-amber-500 shrink-0" />
    default:
      return <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
  }
}
