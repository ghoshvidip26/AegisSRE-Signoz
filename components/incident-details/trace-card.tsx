'use client'

import { ExternalLink, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type TraceSummary = {
  traceId: string
  service: string
  durationMs: number
  spanCount: number
  errorCount: number
  rootSpan: string
  startTime: string
}

export function TraceCard({
  traceId,
  trace,
  signozUrl,
  loading,
  compact = false,
}: {
  traceId?: string | null
  trace: TraceSummary | null
  signozUrl?: string | null
  loading?: boolean
  /** Smaller variant for reuse inside the Overview/Observability tabs. */
  compact?: boolean
}) {
  if (!traceId) {
    return (
      <Card size={compact ? 'sm' : 'default'}>
        <CardHeader>
          <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">Trace</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          No trace recorded yet for this incident.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card size={compact ? 'sm' : 'default'}>
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">Trace</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={compact ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-2 gap-4 sm:grid-cols-4'}>
          <TraceStat label="Trace ID" value={`${traceId.slice(0, 8)}...`} mono />
          <TraceStat
            label="Duration"
            value={
              loading ? '...' : trace ? formatDuration(trace.durationMs) : '—'
            }
          />
          <TraceStat label="Spans" value={loading ? '...' : trace ? String(trace.spanCount) : '—'} />
          <TraceStat
            label="Errors"
            value={loading ? '...' : trace ? String(trace.errorCount) : '—'}
            danger={!loading && !!trace && trace.errorCount > 0}
          />
        </div>

        {!loading && !trace && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Trace ID captured, but span details aren&apos;t available from SigNoz right now
            (query may need auth, or the trace hasn&apos;t indexed yet). Open it directly below.
          </p>
        )}

        {signozUrl && (
          <a
            href={signozUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-all hover:bg-primary/20 hover:scale-105 active:scale-95"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
            Open in SigNoz
          </a>
        )}
      </CardContent>
    </Card>
  )
}

function TraceStat({
  label,
  value,
  mono,
  danger,
}: {
  label: string
  value: string
  mono?: boolean
  danger?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${mono ? 'font-mono' : ''} ${danger ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
