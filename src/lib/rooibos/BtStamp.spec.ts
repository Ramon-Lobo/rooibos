import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const script = path.resolve(__dirname, '../../../scripts/bt-stamp.js');
const realPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));

describe('scripts/bt-stamp.js', function () {
    this.timeout(30000);
    let dir: string;

    function git(...args: string[]) {
        return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    }
    function commit(msg: string) {
        git('commit', '--allow-empty', '-m', msg);
    }
    function stamp() {
        return execFileSync('node', [script, '3'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    }
    const packed = () => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-stamp-'));
        const source = {
            name: 'x', version: '5.17.0', dependencies: { 'roku-deploy': '^4.0.0-alpha.9', 'fs-extra': '^10.1.0' }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(source, null, 4) + '\n');
        fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
            packages: { 'node_modules/roku-deploy': { version: '4.0.0-alpha.9' } }
        }));
        git('init', '-q');
        git('checkout', '-q', '-b', 'bt/test-queue');
        commit('upstream');
        git('tag', 'v5.17.0');
        commit('feat(cli): add opt-in --app-exit-grace (ROO-01)\n\nBT-Patch: ROO-01');
        commit('feat(cli): add opt-in --idle-timeout (ROO-02)');
        commit('feat(cli): add opt-in --continue-on-runtime-error (ROO-03)');
        commit('feat: seed globals\n\nBT-Patch: ROO-04');
        commit('chore(publish): stamp\n\nBT-Patch: ROO-90');
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('writes flags, the pin and the branch name; leaves the source package.json alone', () => {
        const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
        stamp();
        const bt = packed().brighttest;
        expect(bt.queue).to.equal('bt/test-queue');
        expect(bt.pinned).to.eql({ 'roku-deploy': '4.0.0-alpha.9' });
        expect(packed().dependencies['roku-deploy']).to.equal('4.0.0-alpha.9');
        expect(packed().dependencies['fs-extra']).to.equal('^10.1.0');
        expect(bt.patches).to.eql({ 'ROO-01': 1, 'ROO-02': 1, 'ROO-03': 1, 'ROO-04': 1 });
        expect(bt.flags).to.eql(['coverage-dir', 'app-exit-grace', 'idle-timeout', 'continue-on-runtime-error']);
        expect(before).to.contain('^4.0.0-alpha.9');
    });

    it('prefers BT-Flag trailers and follows a renamed branch', () => {
        commit('feat: x\n\nBT-Patch: ROO-02\nBT-Flag: --idle-timeout\nBT-Flag: other-flag');
        git('checkout', '-q', '-b', 'bt/renamed');
        stamp();
        const bt = packed().brighttest;
        expect(bt.queue).to.equal('bt/renamed');
        expect(bt.flags).to.eql(['coverage-dir', 'app-exit-grace', 'idle-timeout', 'other-flag', 'continue-on-runtime-error']);
    });

    it('fails on a detached HEAD', () => {
        git('checkout', '-q', '--detach');
        expect(() => stamp()).to.throw(/detached HEAD/);
    });

    it('stamps the real queue with exactly the four flags and the lock version', () => {
        // a scratch clone of this repo at HEAD (its history, tag and lock), never the worktree itself
        const repo = path.resolve(__dirname, '../../..');
        const lock = JSON.parse(fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8'));
        const clone = path.join(dir, 'clone');
        const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
        execFileSync('git', ['clone', '-q', '--no-hardlinks', repo, clone], { stdio: 'ignore' });
        execFileSync('git', ['checkout', '-q', '-b', 'bt/scratch', head], { cwd: clone, stdio: 'ignore' });
        expect(realPkg.dependencies['roku-deploy']).to.equal('^4.0.0-alpha.9');
        execFileSync('node', [script, '1'], { cwd: clone, stdio: 'ignore' });
        const out = JSON.parse(fs.readFileSync(path.join(clone, 'package.json'), 'utf8'));
        expect(out.brighttest.flags).to.eql(['coverage-dir', 'app-exit-grace', 'idle-timeout', 'continue-on-runtime-error']);
        expect(out.brighttest.queue).to.equal('bt/scratch');
        expect(out.brighttest.pinned['roku-deploy']).to.equal(lock.packages['node_modules/roku-deploy'].version);
        expect(out.dependencies['roku-deploy']).to.equal(lock.packages['node_modules/roku-deploy'].version);
    });
});
