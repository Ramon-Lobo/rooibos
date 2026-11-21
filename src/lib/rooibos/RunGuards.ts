/**
 * Opt-in run-control behaviours for the device CLI (`src/cli.ts`). Every behaviour is off unless its
 * option is given, so a run without the flags behaves exactly as stock rooibos.
 */

export interface RunGuardsOptions {
    /** ROO-01: ms after deploy during which an `app-exit` is ignored. Undefined = stock (never ignored). */
    appExitGraceMs?: number;
}

export interface AppExitDecision {
    /** false: the app-exit is ignored (still inside the grace window) */
    exit: boolean;
    /** set when the run must be reported as a failure */
    failure?: string;
}

const RESULT_REGEX = /\[Rooibos Result\]: (FAIL|PASS)/;

export class RunGuards {
    private appExitArmed: boolean;
    private resultSeen = false;
    private timers: NodeJS.Timeout[] = [];

    constructor(private options: RunGuardsOptions = {}) {
        //stock: the app-exit is honoured immediately
        this.appExitArmed = options.appExitGraceMs === undefined;
    }

    /** Call once the package has been sideloaded. */
    public deployed() {
        if (this.options.appExitGraceMs !== undefined) {
            this.timers.push(setTimeout(() => {
                this.appExitArmed = true;
            }, this.options.appExitGraceMs));
        }
    }

    /** Call for every chunk of device console output. */
    public onOutput(output: string) {
        if (RESULT_REGEX.test(output)) {
            this.resultSeen = true;
        }
    }

    /**
     * Call when the device reports `app-exit`. With ROO-01 on, an exit inside the grace window is the
     * teardown of a previously running channel and is ignored; once armed, an exit that came without a
     * `[Rooibos Result]` line is a failure rather than a silent pass.
     */
    public onAppExit(): AppExitDecision {
        if (!this.appExitArmed) {
            return { exit: false };
        }
        if (this.options.appExitGraceMs !== undefined && !this.resultSeen) {
            return { exit: true, failure: '[rooibos] the app exited without a [Rooibos Result] line - failing the run' };
        }
        return { exit: true };
    }

    public dispose() {
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        this.timers = [];
    }
}
