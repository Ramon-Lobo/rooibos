/**
 * Opt-in run-control behaviours for the device CLI (`src/cli.ts`). Every behaviour is off unless its
 * option is given, so a run without the flags behaves exactly as stock rooibos.
 */

export interface RunGuardsOptions {
    /** ROO-01: ms after deploy during which an `app-exit` is ignored. Undefined = stock (never ignored). */
    appExitGraceMs?: number;
    /** ROO-02: seconds of device silence after which the run is finished. Undefined or <= 0 = no watchdog. */
    idleTimeoutSec?: number;
    /** ROO-03: do not end the run on a runtime error; the run still fails, but later suites keep running. */
    continueOnRuntimeError?: boolean;
    /** ROO-02/03: called when the run is stalled (idle watchdog, or stuck at the debugger prompt). */
    onIdle?: (message: string) => void;
    /** ROO-01: called when the grace window ends with an app-exit that was swallowed and no result line seen. */
    onDeferredExit?: (failure: string) => void;
    /** ROO-03: ms to wait for real output after a continue before declaring the app stuck at the debugger. Default 5000. */
    resumeWaitMs?: number;
}

export interface AppExitDecision {
    /** false: the app-exit is ignored (still inside the grace window) */
    exit: boolean;
    /** set when the run must be reported as a failure */
    failure?: string;
}

const APP_EXIT_FAILURE = '[rooibos] the app exited without a [Rooibos Result] line - failing the run';
const PROMPT_REGEX = /Brightscript Debugger>|can't continue/i;
const RESULT_REGEX = /\[Rooibos Result\]: (FAIL|PASS)/;

export class RunGuards {
    private appExitArmed: boolean;
    private resultSeen = false;
    private timers: NodeJS.Timeout[] = [];
    private idleTimer: NodeJS.Timeout | undefined;
    private deployDone = false;
    private pendingExit = false;
    private stuckTimer: NodeJS.Timeout | undefined;

    constructor(private options: RunGuardsOptions = {}) {
        //stock: the app-exit is honoured immediately
        this.appExitArmed = options.appExitGraceMs === undefined;
    }

    /** Call once the package has been sideloaded. */
    public deployed() {
        this.deployDone = true;
        this.bumpIdle();
        if (this.options.appExitGraceMs !== undefined) {
            this.timers.push(setTimeout(() => {
                this.appExitArmed = true;
                //an app-exit swallowed inside the window is remembered: with no result line it is a real, failing exit
                if (this.pendingExit && !this.resultSeen) {
                    this.pendingExit = false;
                    this.options.onDeferredExit?.(APP_EXIT_FAILURE);
                }
            }, this.options.appExitGraceMs));
        }
    }

    /** Call for every chunk of device console output. */
    public onOutput(output: string) {
        this.bumpIdle();
        if (RESULT_REGEX.test(output)) {
            this.resultSeen = true;
        }
        //real output after a continue means the run resumed
        if (this.stuckTimer && !PROMPT_REGEX.test(output)) {
            clearTimeout(this.stuckTimer);
            this.stuckTimer = undefined;
        }
    }

    /**
     * Call when the device reports `app-exit`. With ROO-01 on, an exit inside the grace window is the
     * teardown of a previously running channel and is ignored; once armed, an exit that came without a
     * `[Rooibos Result]` line is a failure rather than a silent pass.
     */
    public onAppExit(): AppExitDecision {
        if (!this.appExitArmed) {
            this.pendingExit = true;
            return { exit: false };
        }
        if (this.options.appExitGraceMs !== undefined && !this.resultSeen) {
            return { exit: true, failure: APP_EXIT_FAILURE };
        }
        return { exit: true };
    }

    /** Call on a device runtime error. Returns true when the CLI should end the run now (stock behaviour). */
    public onRuntimeError(): boolean {
        return !this.options.continueOnRuntimeError;
    }

    /** ROO-03: the CLI sent a continue to the debugger; start bounding how long the app may stay stuck. */
    public onResumeSent() {
        this.bumpIdle();
        this.armStuck('the app is still at the debugger prompt after a continue (a runtime error cannot be resumed unless rooibos runs with catchCrashes: true)');
    }

    /** ROO-03: the debugger said "Can't continue". */
    public onCannotContinue() {
        if (!this.options.continueOnRuntimeError) {
            return;
        }
        this.fireStuck('[rooibos] --continue-on-runtime-error: the debugger cannot continue after the runtime error (it only continues with rooibos catchCrashes: true) - finishing the run');
    }

    /** The app suspended at the debugger. With a guard flag on, never wait on it silently. */
    public onSuspend() {
        const flagOn = this.options.continueOnRuntimeError || this.options.appExitGraceMs !== undefined || (this.options.idleTimeoutSec ?? 0) > 0;
        if (flagOn && !this.stuckTimer) {
            this.armStuck('the app is suspended at the debugger');
        }
    }

    private armStuck(reason: string) {
        if (this.stuckTimer) {
            clearTimeout(this.stuckTimer);
        }
        this.stuckTimer = setTimeout(() => {
            this.stuckTimer = undefined;
            this.fireStuck(`[rooibos] no progress: ${reason} - finishing the run`);
        }, this.options.resumeWaitMs ?? 5000);
    }

    private fireStuck(message: string) {
        if (this.stuckTimer) {
            clearTimeout(this.stuckTimer);
            this.stuckTimer = undefined;
        }
        this.options.onIdle?.(message);
    }

    private bumpIdle() {
        const seconds = this.options.idleTimeoutSec;
        if (!seconds || seconds <= 0 || !this.deployDone) {
            return;
        }
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        this.idleTimer = setTimeout(() => {
            this.idleTimer = undefined;
            this.options.onIdle?.(`[rooibos] no device output for ${seconds}s - run stalled; finishing with the results captured so far`);
        }, seconds * 1000);
    }

    public dispose() {
        if (this.stuckTimer) {
            clearTimeout(this.stuckTimer);
            this.stuckTimer = undefined;
        }
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        this.timers = [];
    }
}
