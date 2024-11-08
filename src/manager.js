import EventEmitter from 'events';
import child_process from 'child_process';
import { RS_CONSTANTS } from './constants';

// Manages an active rollstarts process
export class RollStartsManager extends EventEmitter {
    #options; // The options passed to the constructor
    #active_process; // The child process that is currently running (if any)
    #temporary_process; // The recurring child process (if any)
    #recover_attempts = 0; // The number of recoveries reamining

    /**
     * @typedef {Object} RollStartsOptions
     * @property {string} path The path to the root Javascript file for your application.
     * @property {boolean} [watch=true] Whether or not to watch the root Javascript file for changes to automatically restart the application.
     * @property {boolean} [recover=true] Whether to automatically recover from a crash within the root Javascript file application.
     * @property {number} [recover_attempts=100] The number of times to attempt recovery from a crashes. Note! This count only applies to a crash loop and will reset if the application remains started for a period of time.
     * @property {number} [recover_ttl_ms=1000] The interval in milliseconds before the recovery attempts count resets.
     * @property {string} [command="node"] The command used to start the application.
     * @property {string[]} [args=[string]] The arguments passed to the command.
     * @property {child_process.SpawnOptions} [options] The options passed when constructing the child process.
     */

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
        this.restart().catch((error) => this.emit('error', error));
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
            const { command = 'node', args = [this.#options.path], options = {} } = this.#options;

            // Generate the environment variables for the child process
            const environment = {
                ...process.env, // Pass through current environment variables
                ...options.env, // Pass through any environment variables specified in the options
            };

            // Store an environment variable to indicate the type of rollstarts child process
            if (this.#active_process) {
                // If we have an active process, then the child process is a recurring process
                environment[RS_CONSTANTS.IS_ROLLSTARTS_RECURRING_PROCESS] = 'true';
            } else {
                // If we don't have an active process, then the child process is the initial process
                // This allows the initial child process to skip the serve delay as there is no previous process to clean up
                environment[RS_CONSTANTS.IS_ROLLSTARTS_INITIAL_PROCESS] = 'true';
            }

            // We always want ipc to be the stdio stream
            const stdio = ['ipc'];
            if (options.stdio) {
                // Push the user's stdio streams onto the default stdio streams
                stdio.push(...options.stdio);
            } else {
                // By default, we will inherit all the stdio streams
                stdio.push('inherit');
            }

            // Create a new recurring process
            const new_process = child_process.spawn(command, args, {
                // Include the user's options to override the defaults
                ...options,

                // By default, we will inherit all the stdio streams
                // The user can override this by passing in their own options
                stdio: Array.from(new Set(stdio)),

                // Include the environment variables
                env: environment,
            });

            // Listen for 'message' events from the recurring process
            new_process.once('message', async (raw) => {
                // Handle incoming messages from the recurring process
                const message = raw.toString();
                switch (message) {
                    case RS_CONSTANTS.IS_READY_TO_SERVE:
                        // Kill the active process (if it exists)
                        if (this.#active_process) {
                            // Kill the active process
                            this.#active_process.kill();

                            // If the active process has not exited, wait for it to exit
                            await new Promise((resolve) => this.#active_process.once('exit', resolve));
                        }

                        // Store this recurring process as the active process
                        this.#active_process = new_process;

                        // Emit an 'active' event for the active process
                        this.emit('active', new_process);

                        // Remove this process as the temporary process if the PID matches
                        if (this.#temporary_process && this.#temporary_process.pid === new_process.pid)
                            this.#temporary_process = null;

                        // Instruct the active process to begin serving information
                        new_process.send(RS_CONSTANTS.SHOULD_BEGIN_TO_SERVE);

                        // Resolve the promise if not already resolved
                        if (this.#restart_promise) {
                            this.#restart_promise = null;
                            resolve();
                        }
                        break;
                }
            });

            // Listen for the 'exit' event from the recurring process
            new_process.once('exit', (code) => {
                // Remove this process as the active process if the PID matches
                if (this.#active_process && this.#active_process.pid === new_process.pid) this.#active_process = null;

                // Remove this process as the temporary process if the PID matches
                if (this.#temporary_process && this.#temporary_process.pid === new_process.pid)
                    this.#temporary_process = null;

                // Emit an 'exit' event for the exited process
                this.emit('exit', new_process, code);

                // If the restart promise is still pending, then reject it with the exit code
                if (this.#restart_promise) {
                    this.#restart_promise = null;
                    reject(new Error(`RollStartsManager: Child Process ${new_process.pid} Exited With Code ${code}`));
                }

                // If auto recover is enabled, then attempt to restart the application to recover it
                if (this.#options.recover) {
                    // Determine if we have more attempts remaining
                    if (this.#recover_attempts > 0) {
                        this.#recover_attempts--;
                        this.restart();
                    }

                    // Emit 'recovers' event with the number of remaining attempts
                    this.emit('recovers', this.#recover_attempts);
                }
            });

            // Store this as the temporary process while it is starting up
            this.#temporary_process = new_process;
        });

        // Return the promise
        return this.#restart_promise;
    }
}
