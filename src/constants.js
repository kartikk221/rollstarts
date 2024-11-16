// This is a sufficient IPC timeout to prevent hanging processes
const IPC_DEFAULT_TIMEOUT_MS = 5000;

// Define constants for consistenty
const RS_CONSTANTS = {
    IPC_TIMEOUT_MS: 'ROLLSTARTS_IPC_TIMEOUT_MS', // Contains the string version of the IPC timeout in milliseconds
    IS_READY_TO_SERVE: 'ROLLSTARTS_IS_READY_TO_SERVE', // This event is sent to the master process when a new rollstarts child process is ready to serving information
    SHOULD_BEGIN_TO_SERVE: 'ROLLSTARTS_SHOULD_BEGIN_TO_SERVE', // This event is sent to the child process to alert the new process to begin serving information
    IS_ROLLSTARTS_INITIAL_PROCESS: 'ROLLSTARTS_IS_ROLLSTARTS_INITIAL_PROCESS', // This environment variable is set to signify to the child process that it is the initial child process
    IS_ROLLSTARTS_RECURRING_PROCESS: 'ROLLSTARTS_IS_ROLLSTARTS_RECURRING_PROCESS', // This environment variable is set to signify to the child process that it is a recurring child process
    REQUEST_RESTART: 'ROLLSTARTS_REQUEST_RESTART', // This event is sent to the master process to request a rolling restart by an active process
    REQUEST_EXIT: 'ROLLSTARTS_REQUEST_EXIT', // This event is sent to the master process to request a rolling restart by an active process
};

module.exports = {
    IPC_DEFAULT_TIMEOUT_MS,
    RS_CONSTANTS,
};
