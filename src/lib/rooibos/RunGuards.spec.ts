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
    });
});
