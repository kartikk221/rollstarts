import fs from 'fs';
import * as RollStarts from '../index.js';

// We will use this to start the current application as a child process
const __filename = decodeURIComponent(
    new URL('', import.meta.url).pathname.split('\\').join('/').replace('file:///', '').replace('/', '')
);

const TESTS_PROCESS_IS_READY = 'RS_TESTS_PROCESS_IS_READY';

if (RollStarts.master()) {
    // Enforce that the restart function throws an error in a master context
    let restart_errored_1 = false;
    try {
        RollStarts.restart();
    } catch (error) {
        restart_errored_1 = true;
    }
    if (!restart_errored_1) throw new Error(`RollStarts.restart() did not throw an error in a master context.`);

    // Enforce that the exit function throws an error in a master context
    let exit_errored_1 = false;
    try {
        RollStarts.exit();
    } catch (error) {
        exit_errored_1 = true;
    }
    if (!exit_errored_1) throw new Error(`RollStarts.exit() did not throw an error in a master context.`);

    // Enforce that the ready function throws an error in a master context
    RollStarts.ready()
        .then(() => {
            throw new Error(`RollStarts.ready() did not throw an error in a master context.`);
        })
        .catch((error) => {}); // We expect this to throw an error

    // Enforce that start() throws an error with no path
    RollStarts.start()
        .then(() => {
            throw new Error(`RollStarts.start() did not throw an error with no path.`);
        })
        .catch((error) => {}); // We expect this to throw an error

    // Enforce that start() throws an error with an invalid path
    RollStarts.start({ path: 'invalid_path' })
        .then(() => {
            throw new Error(`RollStarts.start() did not throw an error with an invalid path.`);
        })
        .catch((error) => {}); // We expect this to throw an error

    // Destroy the state file before testing
    try {
        fs.unlinkSync('state');
    } catch (error) {}

    // Enforce that start() properly starts the application with a valid path
    const events = [];
    let last_event_at = 0;
    RollStarts.start({ path: __filename }).then((manager) => {
        // Track all active events
        manager.on('active', (p) => {
            events.push([last_event_at ? Date.now() - last_event_at : 0, 'active', p.pid]);
            last_event_at = Date.now();

            p.on('message', (raw) => {
                const message = raw.toString();
                if (message === TESTS_PROCESS_IS_READY)
                    events.push([last_event_at ? Date.now() - last_event_at : 0, 'ready', p.pid]);
            });
        });

        // Track all exit events
        manager.on('exit', (p, code) => {
            events.push([last_event_at ? Date.now() - last_event_at : 0, 'exit', p.pid]);
            last_event_at = Date.now();
            p.removeAllListeners('message');
        });

        // Track all recover events
        manager.on('recover', (attempts) => {
            events.push([last_event_at ? Date.now() - last_event_at : 0, 'recover', attempts]);
            last_event_at = Date.now();
        });

        // Track all error events
        manager.on('error', (error) => {
            events.push([last_event_at ? Date.now() - last_event_at : 0, 'error', error]);
            last_event_at = Date.now();
        });

        // Enforce that we do not have an active process yet
        if (manager.active)
            throw new Error(`RollStarts.start() has an active process when it should not have upon creation.`);

        // Enforce that the manager is in flight
        if (!manager.in_flight) throw new Error(`RollStarts.start() manager is not in flight when it should be.`);
    });

    // Log all events before this process exits
    process.on('exit', () => {
        // Destroy the state file
        try {
            fs.unlinkSync('state');
        } catch (error) {}

        // Log all events
        console.log('EVENTS', events);
    });
} else {
    // Enforce that the master context is false in a child process
    if (RollStarts.master()) throw new Error(`RollStarts.master() is true in a child process.`);

    // Define some methods to persist state across multiple restarts
    function get_state() {
        let raw = '';
        try {
            raw = fs.readFileSync('state', 'utf8');
        } catch (error) {}
        if (!isNaN(+raw)) return +raw;
        return 0;
    }

    function set_state(value) {
        fs.writeFileSync('state', value.toString());
    }

    // This is a child process
    (async () => {
        const state = get_state();

        // Pretend we are doing some async work
        await new Promise((res) => setTimeout(res, 100));

        // Wait for the master process to be ready
        await RollStarts.ready();
        console.log('CHILD_PROCESS_READY', process.pid, 'STATE', state);

        // Send a process is ready signal to the master process
        process.send(TESTS_PROCESS_IS_READY);

        // Handle multiple states
        switch (state) {
            case 0:
                // Increment the state to 1
                set_state(1);
                throw new Error('This is an expected error to simulate a crash and test the auto recovery system.');
            case 1:
            case 2:
            case 3:
                // Increment the state to 2
                set_state(state + 1);

                // Test out a child requested restart
                RollStarts.restart();
                break;
            case 4:
                // Increment the state to 2
                set_state(state + 1);

                // Simulate a child exit to test out the auto recovery system
                process.exit();
            case 5:
                // Request the master process to exit to properly exit the application
                RollStarts.exit();
                break;
        }

        // Create a dummy loop to simulate a long running process
        let something = 0;
        setInterval(() => {
            something++;
        }, 1000);
    })();
}
