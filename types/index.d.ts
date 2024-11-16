import { RollStartsManager } from './RollStartsManager';
import { RollStartsOptions } from './types';

/**
 * Returns `true` if the current process is a master process which can start an application and manage sub-processes for zero-downtime rolling restarts.
 * Note! The `start()` should only be called from a master process.
 */
export function master(): boolean;

/**
 * Triggers a rolling restart of the application.
 * Note! This method can ONLY be called from a child process, not the master process.
 */
export function restart(): void;

/**
 * Triggers a complete exit of the whole application including the master process.
 * Note! This method can ONLY be called from a child process, not the master process.
 */
export function exit(code?: number | string | null | undefined): void;

/**
 * Starts an application with zero-downtime rolling restarts using the path to the root Javascript file.
 */
export function start(options: RollStartsOptions): Promise<RollStartsManager>;

/**
 * Returns a `Promise` that resolves once a rolling restart is complete.
 * This means that the old process (if any) has exited and this process has fully replaced it.
 * Note! This can be useful to wait before starting a webserver for example in order to prevent port busy / reuse errors.
 */
export function ready(): Promise<void>;
