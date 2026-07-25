'use client'

import { useState } from 'react'
import { ShieldAlert, Check, X, Loader2 } from 'lucide-react'
import { useIncidentContext } from './incident-context'

const riskTierStyles: Record<string, string> = {
  low: 'bg-secondary/10 text-secondary border-secondary/30',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  high: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
  critical: 'bg-destructive/10 text-destructive border-destructive/30',
}

export function ApprovalBanner() {
  const { activeIncident, approveIncident } = useIncidentContext()
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!activeIncident || activeIncident.status !== 'AWAITING_APPROVAL') {
    return null
  }

  const handleDecision = async (approved: boolean) => {
    setPending(approved ? 'approve' : 'reject')
    setError(null)
    const result = await approveIncident(approved, approved ? undefined : 'Rejected from dashboard')
    if (!result.success) {
      setError(result.error ?? 'Failed to submit decision')
    }
    setPending(null)
  }

  const riskTier = activeIncident.riskTier ?? 'unknown'
  const riskClass = riskTierStyles[riskTier] ?? 'bg-muted/50 text-muted-foreground border-border/40'

  return (
    <div className="flex items-center justify-between gap-4 border-b border-amber-500/30 bg-amber-500/10 px-6 py-3 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
          <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-bold text-foreground">Approval required</p>
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${riskClass}`}>
              {riskTier} risk
            </span>
            {activeIncident.runbookId && (
              <span className="text-[10px] font-mono text-muted-foreground">
                {activeIncident.runbookId}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">
            {activeIncident.approvalReason ?? 'This remediation needs a human decision before it can run.'}
          </p>
          {error && <p className="text-[11px] text-destructive mt-0.5">{error}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => handleDecision(false)}
          disabled={pending !== null}
          className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive transition-all hover:bg-destructive/20 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 cursor-pointer"
        >
          {pending === 'reject' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
          Reject
        </button>
        <button
          onClick={() => handleDecision(true)}
          disabled={pending !== null}
          className="flex items-center gap-1.5 rounded-lg border border-secondary/40 bg-secondary/15 px-3 py-1.5 text-xs font-semibold text-secondary transition-all hover:bg-secondary/25 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 cursor-pointer"
        >
          {pending === 'approve' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Approve
        </button>
      </div>
    </div>
  )
}
