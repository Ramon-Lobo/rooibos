'use strict';
// bt-upstream-watch: read-only upstream compare, writes one rolling issue in this fork.
const TITLE = 'bt-sync';

function parseSemver(tag) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag || '');
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmpSemver(a, b) {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}

// Newest stable (no prerelease suffix) tag name, or null.
function newestStableTag(tagNames) {
    let best = null;
    for (const name of tagNames) {
        const v = parseSemver(name);
        if (v && /^v?\d+\.\d+\.\d+$/.test(name) && (!best || cmpSemver(v, best.v) > 0)) best = { name, v };
    }
    return best ? best.name : null;
}

// Base tag from a default branch name such as bt/2.7.1 or bt/5.17.0-guards.
function baseTagFromBranch(branch) {
    const m = /^bt\/(\d+\.\d+\.\d+)/.exec(branch || '');
    return m ? 'v' + m[1] : null;
}

// facts: { baseTag, newestTag, forkMaster, upstreamMaster, masterCompare }
// masterCompare: { status, behind_by, ahead_by } for fork master ... upstream master, or null if unknown.
function evaluate(facts) {
    const base = parseSemver(facts.baseTag);
    const newest = parseSemver(facts.newestTag);
    const newTag = !!(base && newest && cmpSemver(newest, base) > 0);
    let master;
    if (facts.forkMaster && facts.forkMaster === facts.upstreamMaster) master = 'identical';
    else if (!facts.masterCompare) master = 'unknown';
    else if (facts.masterCompare.status === 'diverged') master = 'diverged';
    else if (facts.masterCompare.behind_by === 0 && facts.masterCompare.ahead_by > 0) master = 'behind';
    else if (facts.masterCompare.ahead_by === 0 && facts.masterCompare.behind_by > 0) master = 'ahead';
    else master = 'identical';
    const level = !newTag && master === 'identical';
    return { newTag, master, level };
}

function renderBody(facts, result, upstream) {
    const cc = facts.masterCompare || {};
    return [
        `Upstream: ${upstream}`,
        `Base tag: ${facts.baseTag || 'unknown'}; newest stable upstream tag: ${facts.newestTag || 'none'}; new tag: ${result.newTag ? 'yes' : 'no'}`,
        `Fork master: ${facts.forkMaster || 'unknown'}; upstream master: ${facts.upstreamMaster || 'unknown'}; state: ${result.master}`,
        `Commits fork master is behind upstream: ${cc.ahead_by ?? 'n/a'}; ahead: ${cc.behind_by ?? 'n/a'}`,
        `Overall: ${result.level ? 'level' : 'action needed (owner syncs master, developer rebases the bt branch)'}`,
        '',
        'Updated by bt-upstream-watch. Read-only against upstream.',
    ].join('\n');
}

async function upstreamGet(path, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
        try {
            const r = await fetch('https://api.github.com' + path, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'bt-upstream-watch' } });
            if (r.status === 404) return null;
            if (r.ok) return await r.json();
            last = new Error('HTTP ' + r.status);
        } catch (e) { last = e; }
    }
    throw last;
}

async function run({ github, context, core }, upstream) {
    const { owner, repo } = context.repo;
    const branch = context.payload.repository.default_branch;
    const forkMasterRef = await github.rest.repos.getBranch({ owner, repo, branch: 'master' });
    const forkMaster = forkMasterRef.data.commit.sha;
    const upMaster = await upstreamGet(`/repos/${upstream}/branches/master`);
    const tags = (await upstreamGet(`/repos/${upstream}/tags?per_page=100`)) || [];
    const upstreamMaster = upMaster && upMaster.commit.sha;
    const masterCompare = upstreamMaster && forkMaster !== upstreamMaster
        ? await upstreamGet(`/repos/${upstream}/compare/${forkMaster}...${upstreamMaster}`) : null;
    const facts = { baseTag: baseTagFromBranch(branch), newestTag: newestStableTag(tags.map((t) => t.name)), forkMaster, upstreamMaster, masterCompare };
    const result = evaluate(facts);
    const body = renderBody(facts, result, upstream);
    const issues = await github.rest.issues.listForRepo({ owner, repo, state: 'all', per_page: 100 });
    const existing = issues.data.find((i) => !i.pull_request && i.title === TITLE);
    const state = result.level ? 'closed' : 'open';
    if (existing) await github.rest.issues.update({ owner, repo, issue_number: existing.number, body, state });
    else if (!result.level) await github.rest.issues.create({ owner, repo, title: TITLE, body });
    core.info(JSON.stringify(result));
}

module.exports = { parseSemver, cmpSemver, newestStableTag, baseTagFromBranch, evaluate, renderBody, run };
