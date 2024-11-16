import fs from 'fs';
import EventEmitter from 'events';
import child_process from 'child_process';
import { RS_CONSTANTS, IPC_DEFAULT_TIMEOUT_MS } from './constants.js';

/**
 * @typedef {Object} RollStartsOptions
 * @property {string} path The path to the root Javascript file for your application.
 * @property {boolean} [watch=true] Whether or not to watch the root Javascript file for changes to automatically restart the application.
 * @property {boolean} [recover=true] Whether to automatically recover from a crash within the root Javascript file application.
 * @property {number} [recover_attempts=100] The number of times to attempt recovery from a crashes. Note! This count only applies to a crash loop and will reset if the application remains started for a period of time.
 * @property {number} [recover_ttl_ms=1000] The interval in milliseconds before the recovery attempts count resets.
 * @property {number} [ipc_timeout_ms=5000] The timeout in milliseconds for IPC messages. This is required to prevent hanging processes.
 * @property {string} [command="node"] The command used to start the application.
 * @property {string[]} [args=[string]] The arguments passed to the command.
 * @property {child_process.SpawnOptions} [options] The options passed when constructing the child process.
 */

// Manages an active rollstarts process
export class RollStartsManager extends EventEmitter {
    #watcher; // The watcher instance (if any)
    #options; // The options passed to the constructor
    #active_process = null; // The active process (if any)
    #temporary_process = null; // The temporary process which will replace the active process (if any)
    #recover_attempts = 0; // The number of recurring recoveries remaining

    /**
     * @param {RollStartsOptions} options
     */
    constructor(options) {
        // Initialize the event emitter
        super();

        // Store the options
        this.#options = options;
        this.#recover_attempts = options.recover_attempts || 100;

        // Trigger a restart to start the application
        this.restart()
            .then(() => this.watch()) // Begin watching the root Javascript file for changes to automatically restart the application
            .catch((error) => this.emit('error', error));
    }

    /**
     * Begins watching the root Javascript file for changes to automatically restart the application.
     */
    async watch() {
        // If watching is disabled, then return
        const should_watch = this.#options.watch !== undefined ? this.#options.watch : true;
        if (!should_watch) return;

        // If there is already a watcher, then return it
        if (this.#watcher) return this.#watcher;

        // Create a watcher instance
        this.#watcher = fs.watch(this.#options.path, () => this.restart());

        // Return the watcher instance
        return this.#watcher;
    }

    #restart_promise;
    /**
     * Performs a zero-downtime rolling restart of the application.
     * If there is no active process, then a normal start is performed to launch the application.
     */
    restart() {
        // If there is an existing restart process, return the promise
        if (this.#restart_promise) return this.#restart_promise;

        // Create a promise to resolve when the restart is complete
        this.#restart_promise = new Promise((resolve, reject) => {
            // Destructure the options
            const {
                command = 'node',
                args = [this.#options.path],
                options = {},
                ipc_timeout_ms = IPC_DEFAULT_TIMEOUT_MS,
            } = this.#options;

            // Generate the environment variables for the child process
            const environment = {
                ...process.env, // Pass through current environment variables
                ...options.env, // Pass through any environment variables specified in the options
            };

            // Include the IPC timeout environment variable
            environment[RS_CONSTANTS.IPC_TIMEOUT_MS] = ipc_timeout_ms.toString();

            // Store an environment variable to indicate the type of rollstarts child process
            if (this.#active_process) {
                // If we have an active process, then the child process is a recurring process
                environment[RS_CONSTANTS.IS_ROLLSTARTS_RECURRING_PROCESS] = 'true';
            } else {
                // If we don't have an active process, then the child process is the initial process
                // This allows the initial child process to skip the serve delay as there is no previous process to clean up
                environment[RS_CONSTANTS.IS_ROLLSTARTS_INITIAL_PROCESS] = 'true';
            }

            // Determine the stdio streams
            // By default, we will inherit all stdio streams
            const stdio = options.stdio || ['inherit', 'inherit', 'inherit', 'ipc'];

            // Warn the user if the ipc stdio stream is not being declared
            if (!stdio.includes('ipc'))
                console.warn(
                    'RollStarts: The ipc stdio stream is not being declared within stdio argument. This may prevent IPC which is required for RollStarts to work properly.'
                );

            // Create a new recurring process
            const new_process = child_process.spawn(command, args, {
                // By default, hide the sub process windows on Windows
                windowsHide: true,

                // Include the user's options to override the defaults
                ...options,

                // By default, we will inherit all the stdio streams
                // The user can override this by passing in their own options
                stdio,

                // Include the environment variables
                env: environment,
            });

            // Pipe all errors from the recurring process to the master process
            new_process.on('error', (error) => this.emit('error', error));

            // Listen for 'message' events from the recurring process
            new_process.on('message', async (raw) => {
                // Handle incoming messages from the recurring process
                const message = raw.toString();
                switch (message) {
                    // Handle the should begin to serve message to initialize the new process
                    case RS_CONSTANTS.IS_READY_TO_SERVE:
                        // Kill the active process (if it exists)
                        if (this.#active_process) this.#active_process.kill();

                        // Store this recurring process as the active process
                        this.#active_process = new_process;

                        // Emit an 'active' event for the active process
                        this.emit('active', new_process);

                        // Remove this process as the temporary process if the PID matches
                        if (this.#temporary_process && this.#temporary_process.pid === new_process.pid)
                            this.#temporary_process = null;

                        // Instruct the active process to begin serving information
                        try {
                            new_process.send(RS_CONSTANTS.SHOULD_BEGIN_TO_SERVE);
                        } catch (error) {}

                        // Resolve the promise if not already resolved
                        if (this.#restart_promise) {
                            this.#restart_promise = null;
                            resolve();
                        }
                        break;

                    // Handle the request restart message to restart the application
                    case RS_CONSTANTS.REQUEST_RESTART:
                        // Trigger a restart
                        this.restart();
                        break;

                    // Handle the rest of the messages
                    default:
                        // Determine if this is a kill request
                        if (message.startsWith(RS_CONSTANTS.REQUEST_EXIT)) {
                            // Parse the kill signal if possible
                            let stripped = message.replace(RS_CONSTANTS.REQUEST_EXIT, '');
                            let signal = stripped ? (isNaN(+stripped) ? stripped : +stripped) : undefined; // Use string if not a number otherwise use number

                            // Disable auto recover
                            this.#options.recover = false;

                            // Kill the process
                            new_process.kill();

                            // Exit the process
                            process.exit(signal);
                        }

                        break;
                }
            });

            // Listen for the 'exit' event from the recurring process
            new_process.once('exit', (code) => {
                // Remove all message listeners from the recurring process
                new_process.removeAllListeners('message');

                // Determine the last active PID
                const last_active_pid = this.#active_process?.pid || this.#temporary_process?.pid;

                // Remove this process as the active process if the PID matches
                if (this.#active_process && this.#active_process.pid === new_process.pid) this.#active_process = null;

                // Remove this process as the temporary process if the PID matches
                if (this.#temporary_process && this.#temporary_process.pid === new_process.pid)
                    this.#temporary_process = null;

                // Emit an 'exit' event for the exited process
                this.emit('exit', new_process, code);

                // If the restart promise is still pending, then reject it with the exit code
                if (this.#restart_promise) {
                    // Clear the restart promise
                    this.#restart_promise = null;
                    reject(new Error(`RollStartsManager: Child Process ${new_process.pid} Exited With Code ${code}`));
                }

                // If auto recover is enabled, then attempt to restart the application to recover it
                const should_recover = this.#options.recover !== undefined ? this.#options.recover : true;
                if (should_recover && last_active_pid === new_process.pid) {
                    // Determine if we have more attempts remaining
                    if (this.#recover_attempts > 0) {
                        this.#recover_attempts--;
                        this.restart();
                    }

                    // Emit 'recover' event with the number of remaining attempts
                    this.emit('recover', this.#recover_attempts);
                }
            });

            // Store this as the temporary process while it is starting up
            this.#temporary_process = new_process;
        });

        // Return the promise
        return this.#restart_promise;
    }

    /**
     * Returns `true` if there is currently a rolling restart in flight.
     */
    get in_flight() {
        return this.#temporary_process !== null;
    }

    /**
     * Returns the active child process which is running the root Javascript file or null if there is no active process at the moment.
     * @returns {import('child_process').ChildProcess|null}
     */
    get active() {
        return this.#active_process;
    }
}
