'use strict';
// bt-rebase-report: turn bt-rebase-check's result.json into one comment on the rolling bt-sync issue.
// Never opens a second issue: it reuses the issue titled bt-sync (open or closed); creates it only when action is needed.
const fs = require('fs');
const TITLE = 'bt-sync';
const MARKER = '<!-- bt-rebase-check -->';

function line(label, t) {
    if (t.status === 'none') return `${label}: none`;
    if (t.status === 'unavailable') return `${label}: unavailable`;
    if (t.status === 'clean') return `${label}: applies cleanly (${t.applied}/${t.total} patches)`;
    const c = t.conflict;
    return `${label}: CONFLICT at patch ${c.index}/${t.total}, patch id ${c.patch.id} (${c.patch.sha} ${c.patch.subject}); files: ${c.files.join(', ') || 'unknown'}`;
}

function needsAction(r) {
    return !r.ok || (r.tag.isNew && r.tag.status === 'clean') || r.master.status === 'conflict';
}

function render(r) {
    if (r.error) return [MARKER, `bt-rebase-check could not run: ${r.error}`].join('\n');
    return [
        MARKER,
        `bt-rebase-check, queue ${r.baseTag}..${r.queueRef} (${(r.queueSha || '').slice(0, 8)})`,
        r.tag.isNew ? line(`New upstream tag ${r.tag.ref}`, r.tag) : `No new upstream tag (newest ${r.tag.ref}, base ${r.baseTag})`,
        r.tag.isNew && r.tag.status === 'clean' ? `Build and pack: ${r.build.status}${r.build.failedStep ? ' (failed step: ' + r.build.failedStep + ')' : ''}; tarball is the 7-day workflow artifact` : null,
        line(`Early warning, upstream ${r.master.ref}`, r.master),
        `Elapsed: ${r.elapsedSeconds}s. Read-only against upstream; nothing was pushed.`,
    ].filter(Boolean).join('\n');
}

async function run({ github, context, core }, resultPath) {
    if (!fs.existsSync(resultPath)) { core.warning('no result.json; nothing to report'); return; }
    const r = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    const { owner, repo } = context.repo;
    const body = render(r);
    const issues = await github.rest.issues.listForRepo({ owner, repo, state: 'all', per_page: 100 });
    let issue = issues.data.find((i) => !i.pull_request && i.title === TITLE);
    if (!issue) {
        if (!needsAction(r)) { core.info('nothing to report'); return; }
        issue = (await github.rest.issues.create({ owner, repo, title: TITLE, body })).data;
        return;
    }
    const comments = await github.rest.issues.listComments({ owner, repo, issue_number: issue.number, per_page: 100 });
    const mine = comments.data.find((c) => c.body && c.body.startsWith(MARKER));
    if (mine) await github.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body });
    else await github.rest.issues.createComment({ owner, repo, issue_number: issue.number, body });
}

module.exports = { render, needsAction, run, MARKER, TITLE };
