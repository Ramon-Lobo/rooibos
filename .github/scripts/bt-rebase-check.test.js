'use strict';
// Fixture-repo dry run of bt-rebase-check.js and unit checks for bt-rebase-report.js. Local repos only, no network.
const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const check = require('./bt-rebase-check.js');
const report = require('./bt-rebase-report.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const ident = ['-c', 'user.name=fx', '-c', 'user.email=fx@localhost', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];
const sh = (cwd, ...args) => execFileSync('git', [...ident, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, f, s) => fs.writeFileSync(path.join(dir, f), s);
const commit = (dir, msg) => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', msg); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-fixture-'));
try {
    // upstream: v1.0.0 with a 5-line a.txt
    const up = path.join(root, 'upstream');
    fs.mkdirSync(up);
    sh(up, 'init', '-q', '-b', 'master');
    write(up, 'package.json', JSON.stringify({ name: 'fx-pkg', version: '1.0.0', files: ['*.txt'] }));
    write(up, 'a.txt', 'one\ntwo\nthree\nfour\nfive\n');
    commit(up, 'v1.0.0');
    sh(up, 'tag', 'v1.0.0');
    // fork with a queue of two patches on bt/1.0.0 (second one edits line five)
    const fork = path.join(root, 'fork');
    sh(root, 'clone', '-q', up, fork);
    sh(fork, 'checkout', '-q', '-b', 'bt/1.0.0');
    write(fork, 'b.txt', 'patch one\n');
    commit(fork, 'feat: add b\n\nBT-Patch: FX-01');
    write(fork, 'a.txt', 'one\ntwo\nthree\nfour\nfive patched\n');
    commit(fork, 'fix: patch five\n\nBT-Patch: FX-02');
    // upstream: v1.1.0 (clean, touches line one), v1.2.0 (conflicts: rewrites line five)
    write(up, 'a.txt', 'one changed\ntwo\nthree\nfour\nfive\n');
    write(up, 'package.json', JSON.stringify({ name: 'fx-pkg', version: '1.1.0', files: ['*.txt'] }));
    commit(up, 'v1.1.0');
    sh(up, 'tag', 'v1.1.0');
    write(up, 'a.txt', 'one changed\ntwo\nthree\nfour\nfive upstream\n');
    commit(up, 'v1.2.0');
    sh(up, 'tag', 'v1.2.0');
    sh(up, 'tag', 'v2.0.0-alpha.1');

    const run = (extra) => {
        const out = fs.mkdtempSync(path.join(root, 'out-'));
        const r = spawnSync('node', [path.join(__dirname, 'bt-rebase-check.js')], {
            encoding: 'utf8', timeout: 120000,
            env: { PATH: process.env.PATH, HOME: process.env.HOME, UPSTREAM_URL: up, QUEUE_REF: 'bt/1.0.0', REPO_DIR: fork, OUT_DIR: out, ...extra },
        });
        const res = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
        return { r, res, out };
    };

    t('(a) clean apply onto a new tag builds, packs and writes the artifact path', () => {
        const { r, res } = run({
            UPSTREAM_REF: 'v1.1.0',
            BUILD_CMDS: 'test -f b.txt\ngrep -q "one changed" a.txt\ngrep -q "five patched" a.txt',
        });
        assert.strictEqual(r.status, 0, r.stdout + r.stderr);
        assert.strictEqual(res.tag.status, 'clean');
        assert.strictEqual(res.tag.applied, 2);
        assert.strictEqual(res.build.status, 'ok');
        assert.ok(res.build.artifact.endsWith('.tgz') && fs.existsSync(res.build.artifact), res.build.artifact);
        assert.match(r.stdout, /artifact .*\.tgz/);
    });
    t('(a2) newest stable tag is picked automatically, prerelease ignored (v1.2.0 conflicts)', () => {
        const { res } = run({});
        assert.strictEqual(res.tag.ref, 'v1.2.0');
        assert.strictEqual(res.tag.status, 'conflict');
    });
    t('(b) conflicting ref reports files and patch ids and does not pass', () => {
        const { r, res } = run({ UPSTREAM_REF: 'v1.2.0', BUILD_CMDS: 'true' });
        assert.strictEqual(r.status, 1);
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.tag.status, 'conflict');
        assert.strictEqual(res.tag.conflict.patch.id, 'FX-02');
        assert.deepStrictEqual(res.tag.conflict.files, ['a.txt']);
        assert.strictEqual(res.build.status, 'skipped');
        assert.match(r.stdout, /FX-02[\s\S]*a\.txt/);
        assert.match(report.render(res), /CONFLICT at patch 2\/2, patch id FX-02[\s\S]*files: a\.txt/);
    });
    t('(b2) failing build step fails the run and names the step', () => {
        const { r, res } = run({ UPSTREAM_REF: 'v1.1.0', BUILD_CMDS: 'true\nfalse' });
        assert.strictEqual(r.status, 1);
        assert.strictEqual(res.build.failedStep, 'false');
    });
    t('(b3) missing queue ref is an error, not a pass', () => {
        const { r, res } = run({ QUEUE_REF: 'bt/9.9.9', BASE_TAG: 'v1.0.0' });
        assert.strictEqual(r.status, 1);
        assert.match(res.error, /queue ref/);
    });
    t('(c) nothing new reports under 2 minutes, master early warning still runs', () => {
        // the fork fixture serves as upstream: its only stable tag is the base tag
        const fork2 = path.join(root, 'fork2');
        sh(root, 'clone', '-q', fork, fork2);
        const out = fs.mkdtempSync(path.join(root, 'out-'));
        const started = Date.now();
        const r = spawnSync('node', [path.join(__dirname, 'bt-rebase-check.js')], {
            encoding: 'utf8', timeout: 120000,
            env: { PATH: process.env.PATH, HOME: process.env.HOME, UPSTREAM_URL: fork, QUEUE_REF: 'bt/1.0.0', BASE_TAG: 'v1.0.0', UPSTREAM_REF: '', UPSTREAM_MASTER: 'master', REPO_DIR: fork2, OUT_DIR: out },
        });
        const res = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
        assert.ok(Date.now() - started < 120000);
        assert.strictEqual(r.status, 0, r.stdout + r.stderr);
        assert.strictEqual(res.ok, true);
        assert.match(r.stdout, /no new upstream tag/);
    });
    t('master conflict is a warning only', () => {
        const { r, res } = run({ UPSTREAM_REF: 'v1.1.0', BUILD_CMDS: 'true' });
        assert.strictEqual(r.status, 0);
        assert.strictEqual(res.master.status, 'conflict');
        assert.match(r.stdout, /::warning::/);
    });
    t('no scratch worktree is left behind in the fork', () => {
        assert.strictEqual(sh(fork, 'worktree', 'list').split('\n').length, 1);
        assert.strictEqual(sh(fork, 'branch', '--list').split('\n').length, 2); // master + bt/1.0.0 (clone default + queue)
    });
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

t('semver helpers', () => {
    assert.strictEqual(check.newestStableTag(['v2.7.1', 'v2.10.0', 'v3.0.0-alpha.1', 'x']), 'v2.10.0');
    assert.strictEqual(check.baseTagFromBranch('bt/5.17.0-guards'), 'v5.17.0');
});
t('report: no new tag renders level text; action rules', () => {
    const res = { baseTag: 'v1.0.0', queueRef: 'bt/1.0.0', queueSha: 'abcdef012', ok: true, tag: { ref: 'v1.0.0', isNew: false, status: 'none' }, master: { ref: 'master', status: 'clean', applied: 2, total: 2 }, build: { status: 'skipped' }, elapsedSeconds: 3 };
    assert.match(report.render(res), /No new upstream tag/);
    assert.strictEqual(report.needsAction(res), false);
    assert.strictEqual(report.needsAction({ ...res, master: { ref: 'master', status: 'conflict' } }), true);
});
console.log(n + ' passed');
