export class AegisError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = "AegisError";
        if (options?.cause !== undefined) {
            (this as { cause?: unknown }).cause = options.cause;
        }
    }
}

export class AegisApiError extends AegisError {
    public readonly status: number;
    public readonly body: unknown;

    constructor(status: number, body: unknown, message?: string) {
        super(message ?? `AegisSRE API returned ${status}`);
        this.name = "AegisApiError";
        this.status = status;
        this.body = body;
    }
}

export class AegisNetworkError extends AegisError {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "AegisNetworkError";
    }
}

export class AegisTimeoutError extends AegisError {
    constructor(message: string) {
        super(message);
        this.name = "AegisTimeoutError";
    }
}
