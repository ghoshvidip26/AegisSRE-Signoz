import { Incident, IncidentOperation } from "./incident";
console.log("IncidentStore initialized");
class IncidentStore {
  private incidents: Incident[] = [];
  create(incident: Omit<Incident, "id" | "createdAt">) {
    const newIncident: Incident = {
      ...incident,
      id: `INC-${Date.now()}`,
      createdAt: new Date(),
    };
    this.incidents.unshift(newIncident);
    return newIncident;
  }

  getAll() {
    console.log("INCIDENTS: ", this.incidents);
    return this.incidents;
  }

  get(id: string) {
    return this.incidents.find(i => i.id === id);
  }

  update(id: string, data: Partial<Incident>) {
    const incident = this.get(id);

    if (!incident) return;

    Object.assign(incident, data);

    return incident;
  }

  addOperation(operation: Omit<IncidentOperation, "id"> & { incidentId: string }) {
    const incident = this.get(operation.incidentId);

    if (!incident) return;

    const { incidentId: _incidentId, ...entry } = operation;

    incident.operationsLog ??= [];

    const created: IncidentOperation = {
      id: crypto.randomUUID(),
      ...entry,
    };

    incident.operationsLog.push(created);

    // Returned so callers can flip a "running" entry to its terminal state
    // once the work finishes (see updateOperation). Existing callers that
    // ignore the return value are unaffected.
    return created;
  }

  updateOperation(incidentId: string, operationId: string, data: Partial<Omit<IncidentOperation, "id">>) {
    const operation = this.get(incidentId)?.operationsLog?.find((op) => op.id === operationId);

    if (!operation) return;

    Object.assign(operation, data);

    return operation;
  }

  clear() {
    this.incidents = [];
    console.log("IncidentStore cleared");
  }
}
declare global {
  // eslint-disable-next-line no-var
  var incidentStore: IncidentStore | undefined;
}

export const incidentStore =
  globalThis.incidentStore ??
  new IncidentStore();

if (process.env.NODE_ENV !== "production") {
  globalThis.incidentStore = incidentStore;
}