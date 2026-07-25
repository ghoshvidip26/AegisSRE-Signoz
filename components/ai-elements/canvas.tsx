import type { ReactFlowProps } from "@xyflow/react";
import { Background, ReactFlow } from "@xyflow/react";
import type { ReactNode } from "react";

import "@xyflow/react/dist/style.css";

type CanvasProps = ReactFlowProps & {
  children?: ReactNode;
};

import { Controls } from "@/components/ai-elements/controls";

const deleteKeyCode = ["Backspace", "Delete"];

export const Canvas = ({ children, ...props }: CanvasProps) => (
  <ReactFlow
    deleteKeyCode={deleteKeyCode}
    fitView
    panOnDrag={true}
    panOnScroll
    selectionOnDrag={true}
    zoomOnDoubleClick={true}
    {...props}
  >
    <Background bgColor="var(--sidebar)" />
    <Controls className="absolute bottom-2 left-2 z-20" />
    {children}
  </ReactFlow>
);
