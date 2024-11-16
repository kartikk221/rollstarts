const fs = require('fs');
const { RollStartsManager } = require('./src/manager.js');
const { IPC_DEFAULT_TIMEOUT_MS, RS_CONSTANTS } = require('./src/constants.js');

/**
 * Returns `true` if the current process is a master process which can start an application and manage sub-processes for zero-downtime rolling restarts.
 * Note! The `start()` should only be called from a master process.
 */
function master() {
    // Return that this process is neither an initial or recurring process
    return (
        !process.env[RS_CONSTANTS.IS_ROLLSTARTS_INITIAL_PROCESS] &&
        !process.env[RS_CONSTANTS.IS_ROLLSTARTS_RECURRING_PROCESS]
    );
}

/**
 * Triggers a rolling restart of the application.
 * Note! This method can ONLY be called from a child process, not the master process.
 */
function restart() {
    // Ensure this is not a master process
    if (!master()) {
        // Send a request to restart the application
        // We do not have to de-duplicate this request as the master process manager will automaticaly de-duplicate all restart requests
        return process.send(RS_CONSTANTS.REQUEST_RESTART);
    }

    // Throw an error if this is not a child process
    throw new Error(
        'RollStarts: This process is NOT a child process and cannot be used to request a restart. Please use the `master()` function to determine if this process is a master or child process.'
    );
}

/**
 * Triggers a complete exit of the whole application including the master process.
 * Note! This method can ONLY be called from a child process, not the master process.
 * @param {number|string|null|undefined} code The exit code to use. If not provided, then the exit code will be set to 0.
 */
function exit(code) {
    // Ensure this is not a master process
    if (!master()) {
        // Send a request to exit the application
        // We do not have to de-duplicate this request as the master process manager will automaticaly de-duplicate all exit requests
        return process.send(`${RS_CONSTANTS.REQUEST_EXIT}${code}`);
    }

    // Throw an error if this is not a child process
    throw new Error(
        'RollStarts: This process is NOT a child process and cannot be used to request an exit. Please use the `master()` function to determine if this process is a master or child process.'
    );
}

/**
 * Starts an application with zero-downtime rolling restarts using the path to the root Javascript file.
 * @param {import("./src/manager").RollStartsOptions} options
 * @returns {Promise<import("./src/manager").RollStartsManager>}
 */
async function start(options = {}) {
    // Ensure that this is a master process
    if (!master())
        throw new Error(
            'RollStarts: This process is NOT a master process and cannot be used to start an application. Please use the `master()` function to determine if this process is a master process.'
        );

    // Ensure the user provides a path to the root Javascript file
    if (!options.path) throw new Error('RollStarts: The options.path argument is required to start an application.');

    // Ensure that the path to the root Javascript file is accessible
    try {
        await fs.promises.access(options.path);
    } catch (cause) {
        throw new Error(
            `RollStarts: Unable to access the application path at "${options.path}". Please ensure the file exists and is accessible.`,
            {
                cause,
            }
        );
    }

    // Return a new roll starts manager instance
    return new RollStartsManager(options);
}

let ready_promise = null;
/**
 * Returns a `Promise` that resolves once a rolling restart is complete.
 * This means that the old process (if any) has exited and this process has fully replaced it.
 * Note! This can be useful to wait before starting a webserver for example in order to prevent port busy / reuse errors.
 * @returns {Promise<void>}
 */
function ready() {
    // If this is an initial process, then immediately resolve
    if (process.env[RS_CONSTANTS.IS_ROLLSTARTS_INITIAL_PROCESS]) {
        // Send a ready to serve message to the master process
        process.send(RS_CONSTANTS.IS_READY_TO_SERVE);

        // Return a promise to resolve once the process is ready
        return Promise.resolve();
    }

    // If this is a recurring process, then send a ready to serve message to the master process and wait for a should begin to serve message
    if (process.env[RS_CONSTANTS.IS_ROLLSTARTS_RECURRING_PROCESS]) {
        // If the process is not connected to the master process, then reject the promise
        if (!process.connected)
            return Promise.reject(
                new Error(
                    'RollStarts: The process is not connected to the master process with an IPC channel. Please ensure the appropriate stdio streams are being passed to the child process to allow for IPC.'
                )
            );

        // If there is already a ready promise, then return it
        if (ready_promise) return ready_promise;

        // Return a Promise which resolves once the master negotiation occurs for cleaning up old process
        ready_promise = new Promise((resolve, reject) => {
            const ipc_timeout_ms = +process.env[RS_CONSTANTS.IPC_TIMEOUT_MS] || IPC_DEFAULT_TIMEOUT_MS;

            // Set a timeout to reject the promise if the process does not respond within the IPC timeout period
            let listener;
            const timeout = setTimeout(() => {
                // Remove the listener from the process
                process.removeListener('message', listener);

                // Reject the promise
                reject(
                    new Error(
                        `RollStarts: The Master Process Did Not Respond Within The IPC Delay Of ${ipc_timeout_ms}ms`
                    )
                );
            }, ipc_timeout_ms);

            // Create a listener on the process to listen for the should begin to serve event.
            listener = (raw) => {
                // Listen for incoming messages which are strings or contain a toString() method
                const message = typeof raw === 'string' ? raw : raw.toString ? raw.toString() : undefined;
                if (message) {
                    switch (message) {
                        // Check for the should begin to serve message
                        case RS_CONSTANTS.SHOULD_BEGIN_TO_SERVE:
                            // Resolve the promise
                            resolve();

                            // Remove the listener from the process
                            process.removeListener('message', listener);

                            // Clear the timeout
                            clearTimeout(timeout);
                            break;
                    }
                }
            };

            // Bind the listener to the process
            process.on('message', listener);

            // Try to safely send the IPC message to negotiate the master process closing the old process and making this the active process
            try {
                process.send(RS_CONSTANTS.IS_READY_TO_SERVE);
            } catch (error) {
                // Reject the promise with the error
                reject(error);
                clearTimeout(timeout);
                process.removeListener('message', listener);
            }
        });

        // Return the ready promise
        return ready_promise;
    }

    // Reject with a promise to ensure the user does not mis-use this function
    return Promise.reject(
        new Error(
            'RollStarts: This process is NOT a child process and cannot be used to wait for a rolling restart to complete. Please use the `master()` function to determine if this process is a master or sub-process process.'
        )
    );
}

module.exports = {
    master,
    restart,
    exit,
    start,
    ready,
};
