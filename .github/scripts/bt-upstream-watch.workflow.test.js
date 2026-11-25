'use strict';
// Static checks on bt-upstream-watch.yml (no network).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'bt-upstream-watch.yml'), 'utf8')
    .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
t('schedule + dispatch only', () => {
    const on = code.slice(code.indexOf('\non:'), code.indexOf('\npermissions:'));
    assert.match(on, /schedule:/); assert.match(on, /workflow_dispatch:/);
    assert.doesNotMatch(on, /push:|pull_request/);
});
t('top-level permissions empty; job has contents read + issues write only', () => {
    assert.match(code, /^permissions: \{\}$/m);
    assert.match(code, /^    permissions:\n      contents: read\n      issues: write\n/m);
    assert.strictEqual((code.match(/^\s+\w[\w-]*: (read|write)$/gm) || []).length, 2);
});
t('all actions pinned to full SHA', () => {
    const uses = code.match(/uses: \S+/g);
    assert.ok(uses.length >= 2);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/);
});
t('checkout does not persist credentials', () => assert.match(code, /persist-credentials: false/));
t('concurrency group, no cancel', () => { assert.match(code, /^concurrency:\n  group: \S+\n  cancel-in-progress: false$/m); });
t('timeout set; no expressions; no run steps', () => {
    assert.match(code, /timeout-minutes: \d+/);
    assert.doesNotMatch(code, /\$\{\{/);
    assert.doesNotMatch(code, /^\s+run:/m);
});
t('no push or write tokens', () => assert.doesNotMatch(code, /git push|secrets\.|\bgh (issue|workflow)/));
console.log(n + ' passed');
