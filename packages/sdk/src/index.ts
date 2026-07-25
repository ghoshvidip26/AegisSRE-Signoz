export { AegisClient } from "./client";
export {
    AegisError,
    AegisApiError,
    AegisNetworkError,
    AegisTimeoutError,
} from "./errors";
export {
    isTerminalStatus,
    TERMINAL_STATUSES,
} from "./utils";
export type {
    AegisClientOptions,
    CaptureOptions,
    Incident,
    IncidentLog,
    IncidentPayload,
    IncidentSeverity,
    IncidentStatus,
    InstallOptions,
    LogLevel,
    ReportOptions,
    RuntimeInfo,
    WaitOptions,
} from "./types";
