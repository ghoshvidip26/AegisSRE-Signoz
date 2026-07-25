'use client'

import { Activity, Cpu, HardDrive, Zap, TrendingUp, Circle, Loader2, CheckCircle2 } from 'lucide-react'
import { useIncidentContext, type WorkflowStepStatus } from './incident-context'

type WorkflowStep = {
  id: string
  label: string
  status: WorkflowStepStatus
}

const levelColors: Record<string, string> = {
  ERROR: 'text-destructive font-bold',
  WARN: 'text-amber-500 font-semibold',
  INFO: 'text-primary',
  DEBUG: 'text-muted-foreground/60',
}

const levelBorderColors: Record<string, string> = {
  ERROR: 'border-destructive/60',
  WARN: 'border-amber-500/60',
  INFO: 'border-primary/30',
  DEBUG: 'border-border/30',
}

export function ContextPanel() {
  const { metrics, logs, workflowState } = useIncidentContext()

  const displayMetrics = metrics ?? {
    cpu: 0,
    memory: 0,
    errorRate: 0,
    latency: 0,
  }

  const workflowSteps: WorkflowStep[] = [
    { id: 'diagnose', label: 'Diagnose Incident', status: workflowState.diagnose },
    { id: 'plan', label: 'Formulate Plan', status: workflowState.plan },
    { id: 'execute', label: 'Execute Action', status: workflowState.execute },
    { id: 'verify', label: 'Verify Resolution', status: workflowState.verify },
  ]

  return (
    <aside className="flex h-full w-[320px] flex-col gap-6 glass-panel rounded-xl p-5 shadow-2xl z-10 transition-all duration-300 bg-card/10 border-border/40 overflow-hidden">
      {/* 1. Live Metrics */}
      <div className="flex flex-col gap-2.5 shrink-0">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center justify-between">
          <span>Live Telemetry</span>
          <span className="flex h-1.5 w-1.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-secondary"></span>
          </span>
        </h3>
        <div className="grid grid-cols-2 gap-2.5">
          <MetricMiniCard
            label="CPU"
            value={`${displayMetrics.cpu.toFixed(2)}%`}
            status={displayMetrics.cpu > 80 ? 'critical' : displayMetrics.cpu > 60 ? 'warning' : 'healthy'}
          />
          <MetricMiniCard
            label="RAM"
            value={`${displayMetrics.memory.toFixed(2)}%`}
            status={displayMetrics.memory > 85 ? 'critical' : displayMetrics.memory > 70 ? 'warning' : 'healthy'}
          />
          <MetricMiniCard
            label="Error"
            value={`${displayMetrics.errorRate}%`}
            status={displayMetrics.errorRate > 10 ? 'critical' : displayMetrics.errorRate > 5 ? 'warning' : 'healthy'}
          />
          <MetricMiniCard
            label="Latency"
            value={`${displayMetrics.latency}ms`}
            status={displayMetrics.latency > 1000 ? 'critical' : displayMetrics.latency > 500 ? 'warning' : 'healthy'}
          />
        </div>
      </div>

      {/* 2. Active Pipeline (Stepper) */}
      <div className="flex flex-col gap-3 shrink-0">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Incident Pipeline
        </h3>
        <div className="relative border-l border-border/40 ml-2 pl-4 py-1.5 space-y-4">
          {workflowSteps.map((step, idx) => (
            <PipelineStepItem key={step.id} step={step} />
          ))}
        </div>
      </div>

      {/* 3. Live Logs (Monospace scrolling) */}
      <div className="flex flex-col gap-2.5 flex-1 min-h-0">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex justify-between items-center">
          <span>Live Operations Tail</span>
          <span className="text-[9px] bg-primary/10 px-1.5 py-0.5 rounded font-mono text-primary font-bold tracking-wider">TAIL -F</span>
        </h3>
        <div className="flex-1 overflow-y-auto rounded-lg border border-border/40 bg-black/35 p-3.5 font-mono text-[10px] leading-relaxed relative scrollbar-thin">
          {logs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground/50 py-10">
              <span className="animate-pulse text-lg mb-1">_</span>
              <p className="text-[9px] uppercase tracking-wider font-semibold">Awaiting agent pipeline...</p>
            </div>
          ) : (
            <div className="space-y-2 text-muted-foreground">
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={`border-l-2 pl-2 py-0.5 hover:bg-white/5 dark:hover:bg-white/2 transition-colors ${levelBorderColors[log.level] ?? levelBorderColors.INFO}`}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-secondary font-medium">[{log.timestamp}]</span>
                    <span className={levelColors[log.level]}>{log.level}</span>
                    {log.step && (
                      <span className="text-muted-foreground/70 uppercase tracking-wider text-[9px]">
                        {log.step}
                      </span>
                    )}
                  </div>
                  <p className="text-foreground/90 break-words mt-0.5">{log.message}</p>
                </div>
              ))}
              <div className="animate-pulse inline-block w-1.5 h-3 bg-foreground/60 ml-0.5" />
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

function MetricMiniCard({
  label,
  value,
  status,
}: {
  label: string
  value: string
  status: 'healthy' | 'warning' | 'critical'
}) {
  const statusColor = {
    healthy: 'text-secondary',
    warning: 'text-amber-600 dark:text-amber-400',
    critical: 'text-destructive',
  }

  const statusBg = {
    healthy: 'bg-secondary/5 border-secondary/20',
    warning: 'bg-amber-500/5 border-amber-500/20',
    critical: 'bg-destructive/5 border-destructive/20',
  }

  return (
    <div className={`glass-card rounded-lg p-3 flex flex-col justify-between border ${statusBg[status]}`}>
      <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-bold mt-1 tracking-tight ${statusColor[status]}`}>{value}</span>
    </div>
  )
}

function PipelineStepItem({ step }: { step: WorkflowStep }) {
  const dotColor = {
    pending: 'bg-muted border-border/60',
    running: 'bg-primary border-primary animate-pulse shadow-[0_0_8px_var(--primary)]',
    waiting: 'bg-amber-500 border-amber-500 animate-pulse shadow-[0_0_8px_theme(colors.amber.500)]',
    completed: 'bg-secondary border-secondary shadow-[0_0_6px_var(--secondary)]',
    failed: 'bg-destructive border-destructive',
  }

  const textStyle = {
    pending: 'text-muted-foreground/60',
    running: 'text-primary font-bold',
    waiting: 'text-amber-600 dark:text-amber-400 font-semibold',
    completed: 'text-foreground font-semibold',
    failed: 'text-destructive font-semibold',
  }

  return (
    <div className="relative flex items-center gap-3">
      {/* Node Bullet */}
      <div className={`absolute -left-[22px] top-[5px] w-2.5 h-2.5 rounded-full border bg-background z-10 transition-all duration-300 ${dotColor[step.status]}`} />

      <div className="flex-1 flex flex-col">
        <span className={`text-xs ${textStyle[step.status]}`}>{step.label}</span>
        {step.status === 'running' && (
          <span className="text-[9px] text-primary/70 animate-pulse mt-0.5">Diagnosing root causes...</span>
        )}
      </div>
      <span className={`text-[9px] uppercase tracking-wider font-semibold opacity-70 ${textStyle[step.status]}`}>{step.status}</span>
    </div>
  )
}
