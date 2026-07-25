'use client'

import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react'

export function VerificationChecklist({
  evidence,
  resolved,
  hasTrace,
  status,
}: {
  /** Each runbook's own verify() evidence lines — real, runbook-specific data. */
  evidence: string[]
  resolved: boolean
  hasTrace: boolean
  status: string
}) {
  const isTerminal = ['RESOLVED', 'FAILED', 'AWAITING_REVIEW'].includes(status)

  if (evidence.length === 0 && !isTerminal) {
    return (
      <p className="text-xs text-muted-foreground">Verification hasn&apos;t run yet.</p>
    )
  }

  return (
    <div className="space-y-2">
      {evidence.map((line, i) => (
        <ChecklistItem key={i} label={line} state={resolved ? 'pass' : 'fail'} />
      ))}
      {isTerminal && (
        <ChecklistItem
          label={hasTrace ? 'Trace recorded and closed in SigNoz' : 'No trace recorded for this incident'}
          state={hasTrace ? 'pass' : 'neutral'}
        />
      )}
    </div>
  )
}

function ChecklistItem({ label, state }: { label: string; state: 'pass' | 'fail' | 'neutral' }) {
  const Icon = state === 'pass' ? CheckCircle2 : state === 'fail' ? XCircle : MinusCircle
  const color = state === 'pass' ? 'text-secondary' : state === 'fail' ? 'text-destructive' : 'text-muted-foreground'

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-card/20 px-3 py-2.5">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
      <span className="text-xs text-foreground/90 break-words">{label}</span>
    </div>
  )
}
