import { expect } from 'chai';
import { RunGuards } from './RunGuards';

const wait = (ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
});

describe('RunGuards', () => {
    let guards: RunGuards;
    afterEach(() => guards?.dispose());

    describe('defaults (every flag off) behave like stock', () => {
        it('honours app-exit immediately, with no failure, even without a result line', () => {
            guards = new RunGuards();
            guards.deployed();
            expect(guards.onAppExit()).to.eql({ exit: true });
        });

        it('ends the run on a runtime error', () => {
            guards = new RunGuards();
            expect(guards.onRuntimeError()).to.be.true;
        });

        it('never fires an idle callback', async () => {
            let fired = false;
            guards = new RunGuards({ onIdle: () => {
                fired = true;
            } });
            guards.deployed();
            guards.onOutput('hello');
            await wait(60);
            expect(fired).to.be.false;
        });

        it('heartbeat lines are harmless without the flag', async () => {
            let fired = false;
            guards = new RunGuards({ onIdle: () => {
                fired = true;
            } });
            guards.deployed();
            guards.onOutput('channel: mem=1KiB');
            await wait(60);
            expect(fired).to.be.false;
        });
    });

    describe('--app-exit-grace (ROO-01)', () => {
        it('ignores app-exit before deploy and inside the grace window', () => {
            guards = new RunGuards({ appExitGraceMs: 40 });
            expect(guards.onAppExit().exit).to.be.false;
            guards.deployed();
            expect(guards.onAppExit().exit).to.be.false;
        });

        it('fails an app-exit after the window when no result line was seen', async () => {
            guards = new RunGuards({ appExitGraceMs: 20 });
            guards.deployed();
            await wait(50);
            const decision = guards.onAppExit();
            expect(decision.exit).to.be.true;
            expect(decision.failure).to.include('without a [Rooibos Result]');
        });

        it('does not fail an app-exit after the window when a result line was seen', async () => {
            guards = new RunGuards({ appExitGraceMs: 20 });
            guards.deployed();
            guards.onOutput('[Rooibos Result]: PASS');
            await wait(50);
            expect(guards.onAppExit()).to.eql({ exit: true });
        });

        it('a zero grace arms immediately after deploy', async () => {
            guards = new RunGuards({ appExitGraceMs: 0 });
            guards.deployed();
            await wait(20);
            expect(guards.onAppExit().failure).to.exist;
        });
    });

    describe('--app-exit-grace pending exit', () => {
        it('fails the run when the grace expires with a swallowed app-exit and no result line', async () => {
            const failures: string[] = [];
            guards = new RunGuards({ appExitGraceMs: 30, onDeferredExit: f => failures.push(f) });
            guards.deployed();
            expect(guards.onAppExit().exit).to.be.false;
            await wait(80);
            expect(failures).to.have.length(1);
            expect(failures[0]).to.include('without a [Rooibos Result]');
        });

        it('does nothing at expiry when a result line was seen', async () => {
            const failures: string[] = [];
            guards = new RunGuards({ appExitGraceMs: 30, onDeferredExit: f => failures.push(f) });
            guards.deployed();
            guards.onAppExit();
            guards.onOutput('[Rooibos Result]: PASS');
            await wait(80);
            expect(failures).to.eql([]);
        });

        it('does nothing at expiry when no exit was swallowed', async () => {
            const failures: string[] = [];
            guards = new RunGuards({ appExitGraceMs: 20, onDeferredExit: f => failures.push(f) });
            guards.deployed();
            await wait(60);
            expect(failures).to.eql([]);
        });
    });

    describe('--idle-timeout (ROO-02)', () => {
        it('fires after the idle period, once', async () => {
            const messages: string[] = [];
            guards = new RunGuards({ idleTimeoutSec: 0.03, onIdle: m => messages.push(m) });
            guards.deployed();
            await wait(100);
            expect(messages).to.have.length(1);
            expect(messages[0]).to.include('no device output');
        });

        it('is reset by output', async () => {
            let fired = false;
            guards = new RunGuards({ idleTimeoutSec: 0.08, onIdle: () => {
                fired = true;
            } });
            guards.deployed();
            for (let i = 0; i < 4; i++) {
                await wait(40);
                guards.onOutput('line');
            }
            expect(fired).to.be.false;
        });

        it('is not reset by channel mem heartbeat lines, so a heartbeat-only stream fires on time', async () => {
            const messages: string[] = [];
            guards = new RunGuards({ idleTimeoutSec: 0.08, onIdle: m => messages.push(m) });
            guards.deployed();
            for (let i = 0; i < 4; i++) {
                await wait(30);
                guards.onOutput('channel: mem=19540KiB{anon=3916,file=15444,shared=180,swap=0},%cpu=0{user=0,sys=0}\n\n');
            }
            await wait(20);
            expect(messages).to.have.length(1);
            expect(messages[0]).to.include('no device output');
        });

        it('is reset by a normal output line between heartbeats', async () => {
            let fired = false;
            guards = new RunGuards({ idleTimeoutSec: 0.08, onIdle: () => {
                fired = true;
            } });
            guards.deployed();
            for (let i = 0; i < 4; i++) {
                await wait(30);
                guards.onOutput('channel: mem=19540KiB{anon=1},%cpu=0{user=0,sys=0}');
                guards.onOutput(i % 2 ? 'real test output' : 'channel: mem=1KiB\nreal test output');
            }
            expect(fired).to.be.false;
        });

        it('does not run before deploy', async () => {
            let fired = false;
            guards = new RunGuards({ idleTimeoutSec: 0.02, onIdle: () => {
                fired = true;
            } });
            guards.onOutput('early');
            await wait(60);
            expect(fired).to.be.false;
        });

        it('dispose cancels it', async () => {
            let fired = false;
            guards = new RunGuards({ idleTimeoutSec: 0.02, onIdle: () => {
                fired = true;
            } });
            guards.deployed();
            guards.dispose();
            await wait(60);
            expect(fired).to.be.false;
        });
    });

    describe('--continue-on-runtime-error (ROO-03)', () => {
        it('does not end the run on a runtime error', () => {
            guards = new RunGuards({ continueOnRuntimeError: true });
            expect(guards.onRuntimeError()).to.be.false;
        });

        it('fails fast when the debugger reports it cannot continue', () => {
            const messages: string[] = [];
            guards = new RunGuards({ continueOnRuntimeError: true, onIdle: m => messages.push(m) });
            guards.onRuntimeError();
            guards.onCannotContinue();
            expect(messages).to.have.length(1);
            expect(messages[0]).to.include('catchCrashes');
        });

        it('fails fast when the app stays at the debugger prompt after continue was sent', async () => {
            const messages: string[] = [];
            guards = new RunGuards({ continueOnRuntimeError: true, resumeWaitMs: 30, onIdle: m => messages.push(m) });
            guards.deployed();
            guards.onRuntimeError();
            guards.onResumeSent();
            guards.onOutput('Brightscript Debugger> ');
            await wait(80);
            expect(messages).to.have.length(1);
            expect(messages[0]).to.include('debugger');
        });

        it('keeps going when real output follows the continue', async () => {
            const messages: string[] = [];
            guards = new RunGuards({ continueOnRuntimeError: true, resumeWaitMs: 30, onIdle: m => messages.push(m) });
            guards.deployed();
            guards.onRuntimeError();
            guards.onResumeSent();
            guards.onOutput('some suite output');
            await wait(80);
            expect(messages).to.eql([]);
        });

        it('suspend with a guard flag on and no resume fails fast; flags off do nothing', async () => {
            const messages: string[] = [];
            guards = new RunGuards({ idleTimeoutSec: 60, resumeWaitMs: 20, onIdle: m => messages.push(m) });
            guards.deployed();
            guards.onSuspend();
            await wait(60);
            expect(messages).to.have.length(1);
            guards.dispose();
            const off: string[] = [];
            guards = new RunGuards({ resumeWaitMs: 20, onIdle: m => off.push(m) });
            guards.deployed();
            guards.onSuspend();
            guards.onCannotContinue();
            await wait(60);
            expect(off).to.eql([]);
        });
    });
});
