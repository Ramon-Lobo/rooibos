'use strict';
// Static checks on bt-rebase-check.yml (no network).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'bt-rebase-check.yml'), 'utf8')
    .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
t('schedule + dispatch only, one fixed cron', () => {
    const on = code.slice(code.indexOf('\non:'), code.indexOf('\npermissions:'));
    assert.match(on, /schedule:/); assert.match(on, /workflow_dispatch:/);
    assert.doesNotMatch(on, /push:|pull_request/);
    assert.strictEqual((on.match(/- cron:/g) || []).length, 1);
    assert.doesNotMatch(on, /- cron: '17 6 \* \* 1'/); // not the W1 minute
});
t('top-level permissions empty; jobs: check contents read; report contents read + issues write', () => {
    assert.match(code, /^permissions: \{\}$/m);
    assert.match(code, /  check:[\s\S]*?    permissions:\n      contents: read\n    steps:/);
    assert.match(code, /  report:[\s\S]*?    permissions:\n      contents: read\n      issues: write\n/);
    assert.strictEqual((code.match(/^\s+\w[\w-]*: (read|write)$/gm) || []).length, 3);
});
t('every job has timeout-minutes', () => {
    const jobs = code.slice(code.indexOf('\njobs:')).split(/\n  (?=\w[\w-]*:\n)/).slice(1);
    assert.ok(jobs.length >= 2);
    for (const j of jobs) assert.match(j, /timeout-minutes: \d+/);
});
t('all actions pinned to full SHA', () => {
    const uses = code.match(/uses: \S+/g);
    assert.ok(uses.length >= 5);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/);
});
t('checkouts do not persist credentials; 7-day artifacts', () => {
    assert.strictEqual((code.match(/persist-credentials: false/g) || []).length, (code.match(/actions\/checkout@/g) || []).length);
    for (const m of code.match(/retention-days: \d+/g)) assert.strictEqual(m, 'retention-days: 7');
});
t('concurrency group, no cancel', () => assert.match(code, /^concurrency:\n  group: \S+\n  cancel-in-progress: false$/m));
t('no push, no secrets, no gh writes, no expressions inside run blocks', () => {
    assert.doesNotMatch(code, /git push|secrets\.|\bgh (issue|workflow|repo)|npm publish/);
    const runs = code.match(/^\s+run: .*$/gm) || [];
    for (const r of runs) assert.doesNotMatch(r, /\$\{\{/);
});
console.log(n + ' passed');
