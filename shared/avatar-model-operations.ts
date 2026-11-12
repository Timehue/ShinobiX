export type ModelRetryCause = 'expired-style' | 'worker-failure';

export type ModelOperations = {
    windowDays: number;
    creationConfigured: boolean;
    paths: Record<'A' | 'B' | 'unknown', { admitted: number; ready: number; failed: number; cancelled: number }>;
    queue: { dispatch: number; publication: number; oldestSeconds: number | null };
    retries: Record<ModelRetryCause | 'unknown', number>;
    failures: Record<string, number>;
    billing: { settledReady: number; averageReadyMicros: number | null; timedJobs: number; workerMilliseconds: number | null };
    versions: { pipeline: string; kit: string; count: number }[];
};
