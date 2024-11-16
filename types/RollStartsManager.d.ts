import EventEmitter from 'events';
import child_process from 'child_process';

export class RollStartsManager extends EventEmitter {
    /**
     * Performs a zero-downtime rolling restart of the application.
     * If there is no active process, then a normal start is performed to launch the application.
     */
    restart(): Promise<void>;

    /**
     * Destroys the manager and all associated resources including active application processes.
     */
    destroy(): void;

    /**
     * Returns `true` if there is currently a rolling restart in flight.
     */
    get in_flight(): boolean;

    /**
     * Returns the active child process which is running the root Javascript file or null if there is no active process at the moment.
     * @returns {import('child_process').ChildProcess|null}
     */
    get active(): child_process.ChildProcess | null;
}
