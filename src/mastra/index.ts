
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';

import { coordinatorAgent } from '../agents/coordinator-agent';
import { classifierAgent } from '../agents/classifier-agent';
import { diagnosisAgent } from '../agents/diagnosis-agent';
import { planningAgent } from '../agents/planning-agent';
import { executionAgent } from '../agents/execution-agent';
import { verificationAgent } from '../agents/verification-agent';
import { incidentWorkflow } from '../workflows/incident-workflow';


export const mastra = new Mastra({
  workflows: { incidentWorkflow },
  agents: {
    coordinatorAgent,
    classifierAgent,
    diagnosisAgent,
    planningAgent,
    executionAgent,
    verificationAgent,
  },
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: "file:./mastra.db",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'aegis-sre',
        exporters: [
          new MastraStorageExporter(),
          new MastraPlatformExporter(),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),
        ],
      },
    },
  }),
});
