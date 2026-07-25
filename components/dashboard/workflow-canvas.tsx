'use client'

import { useMemo } from 'react'
import { Canvas } from '@/components/ai-elements/canvas'
import { Handle, Position, type Node, type Edge, MarkerType } from '@xyflow/react'
import { Zap, Tags, Cpu, Activity, Shield, TrendingUp, CheckCircle2 } from 'lucide-react'
import { useIncidentContext, type WorkflowStepStatus } from './incident-context'

// Define the custom node component
function WorkflowNode({
  data,
}: {
  data: {
    label: string
    description: string
    status: WorkflowStepStatus
    icon: React.ReactNode
  }
}) {
  const borderClass = {
    pending: 'border-border/40 bg-card/30 opacity-60 text-muted-foreground',
    running: 'border-primary bg-primary/10 shadow-[0_0_15px_rgba(79,70,229,0.25)] ring-2 ring-primary/30 animate-pulse text-primary',
    waiting: 'border-amber-500 bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.25)] ring-2 ring-amber-500/30 animate-pulse text-amber-600 dark:text-amber-400',
    completed: 'border-secondary bg-secondary/10 shadow-[0_0_10px_rgba(16,185,129,0.15)] text-secondary',
    failed: 'border-destructive bg-destructive/10 text-destructive',
  }[data.status] || 'border-border/40 bg-card/30'

  const badgeColor = {
    pending: 'bg-muted/50 text-muted-foreground',
    running: 'bg-primary text-primary-foreground font-bold',
    waiting: 'bg-amber-500 text-white font-bold',
    completed: 'bg-secondary text-secondary-foreground font-bold',
    failed: 'bg-destructive text-destructive-foreground font-bold',
  }[data.status] || 'bg-muted text-muted-foreground'

  return (
    <div className={`p-5 rounded-xl border backdrop-blur-md transition-all duration-300 w-64 flex flex-col gap-1.5 ${borderClass}`}>
      <Handle type="target" position={Position.Left} className="w-1.5 h-1.5 !bg-primary/60 border-none" />
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-card/50 border border-border/20">
          {data.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-foreground leading-tight">{data.label}</p>
          <p className="text-sm text-muted-foreground leading-tight">{data.description}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-0.5">
        <span className={`text-sm font-bold uppercase tracking-wider px-2.5 py-1 rounded-md ${badgeColor}`}>
          {data.status}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="w-1.5 h-1.5 !bg-primary/60 border-none" />
    </div>
  )
}

const nodeTypes = {
  workflowNode: WorkflowNode,
}

export function WorkflowCanvas() {
  const { workflowState } = useIncidentContext()

  const { nodes, edges } = useMemo(() => {
    const stageDefs = [
      { id: 'coordinator', label: 'Coordinator Agent', description: 'Initialize incident response', icon: <Zap className="h-5 w-5" />, status: workflowState.coordinator },
      { id: 'classify', label: 'Classifier', description: 'Categorize incident type', icon: <Tags className="h-3.5 w-3.5" />, status: workflowState.classify },
      { id: 'diagnose', label: 'Diagnosis Agent', description: 'Analyze telemetry & logs', icon: <Cpu className="h-3.5 w-3.5" />, status: workflowState.diagnose },
      { id: 'plan', label: 'Remediation Plan', description: 'Generate remediation steps', icon: <Activity className="h-3.5 w-3.5" />, status: workflowState.plan },
      {
        id: 'approval',
        label: 'Approval Agent',
        description: workflowState.approval === 'waiting' ? 'Awaiting human approval' : 'Risk-based approval routing',
        icon: <Shield className="h-3.5 w-3.5" />,
        status: workflowState.approval,
      },
      { id: 'execute', label: 'Execute Remediation', description: 'Run approved recovery plans', icon: <TrendingUp className="h-3.5 w-3.5" />, status: workflowState.execute },
      { id: 'verify', label: 'Verification Agent', description: 'Verify system restabilization', icon: <CheckCircle2 className="h-3.5 w-3.5" />, status: workflowState.verify },
    ]

    const nodesList: Node[] = stageDefs.map((stage, i) => ({
      id: stage.id,
      type: 'workflowNode',
      position: { x: 60 + i * 300, y: 90 },
      data: {
        label: stage.label,
        description: stage.description,
        status: stage.status,
        icon: stage.icon,
      },
    }))

    const edgeColor = (sourceStatus: WorkflowStepStatus, targetStatus: WorkflowStepStatus) => {
      if (targetStatus === 'running') return '#6366f1'
      if (targetStatus === 'waiting') return '#f59e0b'
      if (sourceStatus === 'completed') return '#10b981'
      return 'rgba(148, 163, 184, 0.2)'
    }

    const getEdgeStyle = (sourceStatus: WorkflowStepStatus, targetStatus: WorkflowStepStatus) => {
      const color = edgeColor(sourceStatus, targetStatus)
      const isActive = targetStatus === 'running' || targetStatus === 'waiting' || sourceStatus === 'completed'
      return {
        stroke: color,
        strokeWidth: isActive ? 2 : 1.5,
        strokeDasharray: targetStatus === 'running' || targetStatus === 'waiting' ? '5,5' : undefined,
      }
    }

    const edgesList: Edge[] = []
    for (let i = 0; i < stageDefs.length - 1; i++) {
      const source = stageDefs[i]
      const target = stageDefs[i + 1]
      edgesList.push({
        id: `e-${source.id}-${target.id}`,
        source: source.id,
        target: target.id,
        animated: target.status === 'running' || target.status === 'waiting',
        style: getEdgeStyle(source.status, target.status),
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(source.status, target.status) },
      })
    }

    return { nodes: nodesList, edges: edgesList }
  }, [workflowState])

  return (
    <div className="h-full w-full relative">
      <Canvas nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={0.5} maxZoom={1.5} fitViewOptions={{ padding: 0.15 }} />
    </div>
  )
}
