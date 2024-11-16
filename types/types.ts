import child_process from 'child_process';

// Define the options passed to the start() function
export interface RollStartsOptions {
    path: string; // The path to the root Javascript file for your application.
    watch?: boolean; // Whether or not to watch the root Javascript file for changes to automatically restart the application.
    recover?: boolean; // Whether to automatically recover from a crash within the root Javascript file application.
    recover_attempts?: number; // The number of times to attempt recovery from a crashes. Note! This count only applies to a crash loop and will reset if the application remains started for a period of time.
    recover_ttl_ms?: number; // The interval in milliseconds before the recovery attempts count resets.
    ipc_timeout_ms?: number; // The timeout in milliseconds for IPC messages. This is required to prevent hanging processes.
    command?: string; // The command used to start the application.
    args?: string[]; // The arguments passed to the command.
    options?: child_process.SpawnOptions; // The options passed when constructing the child process.
}
