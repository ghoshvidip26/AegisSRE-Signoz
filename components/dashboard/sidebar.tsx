'use client'
import { Shield, Activity, AlertTriangle, CheckCircle, Clock, GitBranch, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useIncidentContext } from './incident-context'
import { useState, useEffect } from 'react'
import Link from 'next/link'

const SIGNOZ_URL = process.env.NEXT_PUBLIC_SIGNOZ_URL ?? 'http://localhost:8080'

type Incident = {
  id: string
  title: string
  severity: 'P1' | 'P2' | 'P3' | 'P4'
  status: 'active' | 'investigating' | 'resolved'
  service: string
  timestamp: string
  createdAt?: string
  resolvedAt?: number
  runbookId?: string | null
}

const severityColors: Record<string, string> = {
  P1: 'bg-destructive/10 text-destructive border-destructive/20',
  P2: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  P3: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  P4: 'bg-primary/10 text-primary border-primary/20',
  Investigating: 'bg-primary/10 text-primary border-primary/20',
}

const statusIcons: Record<string, React.ReactNode> = {
  active: <AlertTriangle className="h-3 w-3 text-destructive" />,
  investigating: <Clock className="h-3 w-3 text-amber-500" />,
  resolved: <CheckCircle className="h-3 w-3 text-secondary" />,
}

export function Sidebar({ onSelectIncident, selectedIncidentId }: { onSelectIncident?: (id: string) => void; selectedIncidentId?: string | null }) {
  const { metrics, workflowState, activeIncident } = useIncidentContext()
  console.log("METRICS: ", metrics);
  console.log("WORKFLOW STATE: ", workflowState);
  console.log("ACTIVE INCIDENT: ", activeIncident);
  const [incident, setIncident] = useState<Incident[]>();
  const [otelHealthy, setOtelHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    const fetchIncident = async () => {
      const res = await fetch('/api/incidents')
      const data = await res.json()
      setIncident(data.incident);
      // Auto-select the latest open incident if none selected
      if (!selectedIncidentId && data.incident?.length > 0) {
        const open = data.incident.find((i: Incident) => i.status !== 'resolved')
        if (open && onSelectIncident) {
          onSelectIncident(open.id)
        }
      }
    }
    fetchIncident();
    // Poll for new incidents every 5s
    const interval = setInterval(fetchIncident, 5000)
    return () => clearInterval(interval)
  }, []);

  useEffect(() => {
    const checkOtelHealth = async () => {
      try {
        const res = await fetch('/api/telemetry/health')
        const data = await res.json()
        setOtelHealthy(Boolean(data.healthy))
      } catch {
        setOtelHealthy(false)
      }
    }
    checkOtelHealth()
    // Server-side cached (15s) — polling every 15s here keeps it fresh
    // without adding extra load beyond what the cache already absorbs.
    const interval = setInterval(checkOtelHealth, 15000)
    return () => clearInterval(interval)
  }, []);

  // Derive system health from the fetched incidents list
  const allIncidents = incident || []
  const activeIncidents = allIncidents.filter((i) => i.status !== 'resolved')
  const resolvedIncidents = allIncidents.filter((i) => i.status === 'resolved')
  const uniqueServices = new Set(allIncidents.map((i) => i.service))
  const degradedServices = new Set(activeIncidents.map((i) => i.service))
  const healthyServiceCount = uniqueServices.size - degradedServices.size
  const totalServiceCount = Math.max(uniqueServices.size, 1) // at least 1 to avoid 0/0

  // Uptime: if there are active incidents, degrade proportionally
  const uptimePercent = activeIncidents.length === 0
    ? 99.99
    : Math.max(95, 99.99 - activeIncidents.length * 0.3)

  // Alerts: count P1 and P2 severity incidents that are not resolved
  const alertCount = activeIncidents.filter(
    (i) => i.severity === 'P1' || i.severity === 'P2'
  ).length
  // Also add metric-based alerts when metrics are available
  const metricAlerts = metrics
    ? (metrics.cpu > 80 ? 1 : 0) +
    (metrics.memory > 85 ? 1 : 0) +
    (metrics.errorRate > 5 ? 1 : 0) +
    (metrics.latency > 1000 ? 1 : 0)
    : 0

  // Real backend status values are uppercase ("RESOLVED", not "resolved") —
  // checked correctly here even though the pre-existing filters above
  // compare lowercase (left as-is, not touching existing behavior).
  const resolvedWithDuration = allIncidents.filter(
    (i) => (i.status as string) === 'RESOLVED' && i.resolvedAt && i.createdAt
  )
  const avgResolutionMs = resolvedWithDuration.length > 0
    ? resolvedWithDuration.reduce(
      (sum, i) => sum + (i.resolvedAt! - new Date(i.createdAt!).getTime()),
      0
    ) / resolvedWithDuration.length
    : null
  const avgResolutionLabel = avgResolutionMs === null
    ? '—'
    : avgResolutionMs < 60000
      ? `${Math.round(avgResolutionMs / 1000)}s`
      : `${Math.round(avgResolutionMs / 60000)}m`

  const runbookIncidents = allIncidents.filter((i) => i.runbookId)
  const successfulRunbooks = runbookIncidents.filter((i) => (i.status as string) === 'RESOLVED').length
  const runbookSuccessRate = runbookIncidents.length > 0
    ? Math.round((successfulRunbooks / runbookIncidents.length) * 100)
    : null

  const healthData = {
    services: `${healthyServiceCount}/${totalServiceCount}`,
    uptime: `${uptimePercent.toFixed(1)}%`,
    incidents: String(activeIncidents.length),
    alerts: String(alertCount + metricAlerts),
  }


  // Determine which incidents to show
  const hasActiveWorkflow = workflowState.diagnose !== 'pending'

  return (
    <aside className="flex h-full w-72 flex-col glass-panel rounded-2xl overflow-hidden shadow-2xl z-10 transition-all duration-300 bg-card/10 border-border/40">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border/40 px-6 py-5 bg-card/20">
        <Shield className="h-5 w-5 text-primary" />
        <h1 className="text-sm font-semibold tracking-tight text-foreground">Aegis SRE</h1>
      </div>

      {/* Service Health Summary */}
      <div className="border-b border-border/40 px-6 py-4">
        <h2 className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          System Health
        </h2>
        <div className="grid grid-cols-2 gap-2.5">
          <HealthCard
            label="Services"
            value={healthData.services}
            status={degradedServices.size > 0 ? (degradedServices.size > 2 ? 'critical' : 'warning') : 'healthy'}
          />
          <HealthCard
            label="Uptime"
            value={healthData.uptime}
            status={uptimePercent < 99 ? 'critical' : uptimePercent < 99.9 ? 'warning' : 'healthy'}
          />
          <HealthCard
            label="Incidents"
            value={healthData.incidents}
            status={activeIncidents.length > 0 ? 'critical' : 'healthy'}
          />
          <HealthCard
            label="Alerts"
            value={healthData.alerts}
            status={Number(healthData.alerts) > 2 ? 'critical' : Number(healthData.alerts) > 0 ? 'warning' : 'healthy'}
          />
        </div>
      </div>

      {/* Observability — SigNoz-backed stats, real data only */}
      <div className="border-b border-border/40 px-6 py-4">
        <h2 className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Observability
        </h2>
        <div className="grid grid-cols-2 gap-2.5">
          {activeIncident?.trace?.traceId ? (
            <a
              href={`${SIGNOZ_URL}/trace/${activeIncident.trace.traceId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <HealthCard
                label="Current Trace"
                value={`${activeIncident.trace.traceId.slice(0, 8)}...`}
                status="healthy"
              />
            </a>
          ) : (
            <HealthCard label="Current Trace" value="No Active Trace" status="healthy" />
          )}
          <HealthCard
            label="OpenTelemetry"
            value={otelHealthy === null ? '...' : otelHealthy ? 'Healthy' : 'Unreachable'}
            status={otelHealthy === null ? 'healthy' : otelHealthy ? 'healthy' : 'critical'}
          />
          {/* <HealthCard
            label="Avg Resolution"
            value={avgResolutionLabel}
            status="healthy"
          />
          <HealthCard
            label="Runbook Success"
            value={runbookSuccessRate === null ? '—' : `${runbookSuccessRate}%`}
            status={runbookSuccessRate === null ? 'healthy' : runbookSuccessRate >= 80 ? 'healthy' : runbookSuccessRate >= 50 ? 'warning' : 'critical'}
          /> */}
        </div>
      </div>

      {/* Active Incident from Context */}
      {activeIncident && (
        <div className="border-b border-border/40 px-6 py-4 bg-destructive/5">
          <h2 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Current Investigation
          </h2>
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 shadow-md shadow-destructive/5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-muted-foreground font-semibold">{activeIncident.id}</span>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 rounded-md font-semibold border ${severityColors[activeIncident.severity] || severityColors.P2}`}
              >
                {activeIncident.severity}
              </Badge>
            </div>
            <p className="mt-2 text-xs font-bold leading-tight text-foreground">
              {activeIncident.title}
            </p>
            {activeIncident.status === 'AWAITING_APPROVAL' ? (
              <div className="mt-2.5 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">Awaiting approval...</span>
              </div>
            ) : hasActiveWorkflow && (
              <div className="mt-2.5 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-primary animate-pulse" />
                <span className="text-[10px] text-primary font-semibold">Agent working...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Incident List */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <h2 className="mb-2.5 px-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Recent Incidents
        </h2>
        <div className="space-y-2.5">
          {(incident || []).map((inc) => {
            const isActive = activeIncident?.id === inc.id
            const isSelected = selectedIncidentId === inc.id
            return (
              <div
                key={inc.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectIncident?.(inc.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelectIncident?.(inc.id)
                }}
                className={`w-full text-left p-3.5 rounded-xl border transition-all duration-200 cursor-pointer ${isSelected
                  ? 'border-primary bg-primary/10 shadow-md shadow-primary/5'
                  : isActive
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border/40 bg-card/30 hover:bg-muted hover:border-border/60'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-muted-foreground font-medium">
                    {inc.id}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-semibold px-1.5 py-0 rounded-md border ${severityColors[inc.severity]}`}
                    >
                      {inc.severity}
                    </Badge>
                    <Link
                      href={`/incidents/${inc.id}`}
                      onClick={(e) => e.stopPropagation()}
                      title="View Details"
                      className="text-muted-foreground hover:text-primary transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
                <p className="mt-2 text-xs font-semibold leading-tight text-foreground truncate">
                  {inc.title}
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    {statusIcons[inc.status]}
                    <span className="text-[10px] text-muted-foreground capitalize font-medium">
                      {inc.status}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {inc.timestamp}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border/40 px-6 py-4 bg-card/20">
        <div className="flex items-center gap-2">
          <Activity className="h-3 w-3 text-secondary animate-pulse" />
          <span className="text-xs font-semibold text-muted-foreground">Agent Online</span>
        </div>
      </div>
    </aside>
  )
}

function HealthCard({
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

  return (
    <div className="glass-card rounded-xl px-3 py-2.5 hover:scale-[1.03] transition-all duration-200 border-border/30 bg-card/10">
      <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold mt-0.5 ${statusColor[status]}`}>{value}</p>
    </div>
  )
}
