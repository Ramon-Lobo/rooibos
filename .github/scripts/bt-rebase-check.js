'use strict';
// bt-rebase-check: dry-run the patch queue (<base_tag>..<queue_ref>) onto upstream refs.
// Reads upstream only; writes nothing but a scratch worktree and OUT_DIR. No push, no branch, no tag.
//
// Environment (all optional unless noted):
//   UPSTREAM_URL      (required) upstream git URL (tests point it at a local fixture repo)
//   QUEUE_REF         (required) branch holding the queue in this repo, for example bt/2.7.1
//   BASE_TAG          upstream tag the queue sits on (default: derived from QUEUE_REF, bt/2.7.1 -> v2.7.1)
//   UPSTREAM_REF      upstream tag or branch to apply onto (default: newest stable upstream tag)
//   UPSTREAM_MASTER   upstream branch for the early warning (default: master)
//   REPO_DIR          this repo's checkout (default: cwd); needs the queue ref and the base tag
//   OUT_DIR           result.json and artifact/ go here (default: $RUNNER_TEMP/bt-rebase-check or a temp dir)
//   BUILD_CMDS        newline separated commands run in the rebased tree when the queue applies cleanly onto a NEW tag
//   PACK_DIR          directory, relative to the tree, where `npm pack` runs (default: .)
//   STEP_TIMEOUT_S    per build command timeout in seconds (default: 1500)
// Exit code: 0 when there is nothing new or the queue applied onto the new tag and built; 1 on a conflict onto the
// tag, a missing ref or a failed build. A conflict onto upstream master is a warning only (exit 0).
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function parseSemver(tag) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag || '');
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmpSemver(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
}

// Newest stable tag name (no prerelease suffix), or null.
function newestStableTag(names) {
    let best = null;
    for (const name of names) {
        const v = parseSemver(name);
        if (v && (!best || cmpSemver(v, best.v) > 0)) best = { name, v };
    }
    return best ? best.name : null;
}

function baseTagFromBranch(branch) {
    const m = /^bt\/(\d+\.\d+\.\d+)/.exec(branch || '');
    return m ? 'v' + m[1] : null;
}

function git(cwd, args, opts = {}) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, ...opts }).trim();
}

function tryGit(cwd, args) {
    try { return git(cwd, args); } catch (e) { return null; }
}

// Fetch one upstream ref (tag first, then branch) and return its commit sha, or null.
function fetchUpstream(repo, url, ref) {
    for (const spec of [`refs/tags/${ref}`, `refs/heads/${ref}`]) {
        if (tryGit(repo, ['fetch', '--quiet', '--no-tags', url, spec]) !== null) return git(repo, ['rev-parse', 'FETCH_HEAD^{commit}']);
    }
    return null;
}

function listUpstreamTags(repo, url) {
    const out = git(repo, ['ls-remote', '--tags', '--refs', url]);
    return out.split('\n').map((l) => l.split('\t')[1]).filter(Boolean).map((r) => r.replace(/^refs\/tags\//, ''));
}

function patchInfo(repo, sha) {
    const id = tryGit(repo, ['log', '-1', '--format=%(trailers:key=BT-Patch,valueonly,separator=%x2C)', sha]);
    return { id: id || git(repo, ['rev-parse', '--short', sha]), sha: git(repo, ['rev-parse', '--short', sha]), subject: git(repo, ['log', '-1', '--format=%s', sha]) };
}

// Apply the queue onto targetSha in a detached scratch worktree. Returns { status, applied, total, conflict, wt }.
function applyQueue(repo, work, label, targetSha, queue, env) {
    const wt = path.join(work, 'wt-' + label);
    git(repo, ['worktree', 'add', '--quiet', '--detach', wt, targetSha]);
    const res = { status: 'clean', applied: 0, total: queue.length, conflict: null, wt };
    for (const sha of queue) {
        const patch = execFileSync('git', ['format-patch', '-1', '--stdout', sha], { cwd: repo, encoding: 'utf8' });
        const r = spawnSync('git', ['am', '--3way', '--quiet'], { cwd: wt, input: patch, encoding: 'utf8', env, timeout: 300000 });
        if (r.status !== 0) {
            const files = (tryGit(wt, ['diff', '--name-only', '--diff-filter=U']) || '').split('\n').filter(Boolean);
            res.status = 'conflict';
            res.conflict = { index: res.applied + 1, patch: patchInfo(repo, sha), files };
            tryGit(wt, ['am', '--abort']);
            break;
        }
        res.applied++;
    }
    return res;
}

function removeWorktree(repo, wt) {
    tryGit(repo, ['worktree', 'remove', '--force', wt]);
}

function runBuild(wt, cmds, packDir, outDir, timeoutS) {
    for (const cmd of cmds) {
        const r = spawnSync('bash', ['-euo', 'pipefail', '-c', cmd], { cwd: wt, stdio: 'inherit', timeout: timeoutS * 1000 });
        if (r.status !== 0) return { status: 'failed', failedStep: cmd, artifact: null };
    }
    const artDir = path.join(outDir, 'artifact');
    fs.mkdirSync(artDir, { recursive: true });
    const r = spawnSync('npm', ['pack', '--silent', '--pack-destination', artDir], { cwd: path.join(wt, packDir), encoding: 'utf8', timeout: timeoutS * 1000 });
    if (r.status !== 0) return { status: 'failed', failedStep: 'npm pack', artifact: null };
    const name = r.stdout.trim().split('\n').pop();
    return { status: 'ok', failedStep: null, artifact: path.join(artDir, name) };
}

function main(env = process.env) {
    const started = Date.now();
    const need = (k) => { if (!env[k]) throw new Error(`${k} is required`); return env[k]; };
    const url = need('UPSTREAM_URL');
    const queueRef = need('QUEUE_REF');
    const repo = path.resolve(env.REPO_DIR || '.');
    const outDir = path.resolve(env.OUT_DIR || path.join(env.RUNNER_TEMP || fs.mkdtempSync(path.join(os.tmpdir(), 'bt-out-')), 'bt-rebase-check'));
    const masterRef = env.UPSTREAM_MASTER || 'master';
    fs.mkdirSync(outDir, { recursive: true });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-rebase-wt-'));
    const gitEnv = { ...process.env, GIT_COMMITTER_NAME: 'bt-rebase-check', GIT_COMMITTER_EMAIL: 'bt-rebase-check@localhost' };
    const result = { baseTag: null, queueRef, queueSha: null, tag: { ref: null, sha: null, isNew: false, status: 'none' }, master: { ref: masterRef, sha: null, status: 'none' }, build: { status: 'skipped', failedStep: null, artifact: null }, ok: true, error: null, elapsedSeconds: 0 };
    const keep = [];
    try {
        const baseTag = env.BASE_TAG || baseTagFromBranch(queueRef);
        if (!baseTag) throw new Error(`cannot derive the base tag from ${queueRef}; set BASE_TAG`);
        result.baseTag = baseTag;
        const baseSha = tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/tags/${baseTag}^{commit}`]) || fetchUpstream(repo, url, baseTag);
        if (!baseSha) throw new Error(`base tag ${baseTag} not found`);
        const queueSha = ['refs/remotes/origin/' + queueRef, 'refs/heads/' + queueRef, queueRef]
            .map((r) => tryGit(repo, ['rev-parse', '--verify', '--quiet', r + '^{commit}'])).find(Boolean);
        if (!queueSha) throw new Error(`queue ref ${queueRef} not found`);
        result.queueSha = queueSha;
        const queue = git(repo, ['rev-list', '--reverse', '--no-merges', `${baseSha}..${queueSha}`]).split('\n').filter(Boolean);
        if (queue.length === 0) throw new Error(`queue ${baseTag}..${queueRef} is empty`);

        // (a) newest upstream stable tag, or the explicit ref
        const explicit = env.UPSTREAM_REF || '';
        const tagRef = explicit || newestStableTag(listUpstreamTags(repo, url));
        if (!tagRef) throw new Error('no stable upstream tag found');
        result.tag.ref = tagRef;
        const bv = parseSemver(baseTag), tv = parseSemver(tagRef);
        result.tag.isNew = explicit ? tagRef !== baseTag : !!(bv && tv && cmpSemver(tv, bv) > 0);
        if (result.tag.isNew) {
            const sha = fetchUpstream(repo, url, tagRef);
            if (!sha) throw new Error(`upstream ref ${tagRef} not found`);
            result.tag.sha = sha;
            const a = applyQueue(repo, work, 'tag', sha, queue, gitEnv);
            Object.assign(result.tag, { status: a.status, applied: a.applied, total: a.total, conflict: a.conflict });
            if (a.status === 'clean') keep.push(a.wt); else { removeWorktree(repo, a.wt); result.ok = false; }
            if (a.status === 'clean' && env.BUILD_CMDS) {
                const cmds = env.BUILD_CMDS.split('\n').map((s) => s.trim()).filter(Boolean);
                result.build = runBuild(a.wt, cmds, env.PACK_DIR || '.', outDir, Number(env.STEP_TIMEOUT_S || 1500));
                if (result.build.status !== 'ok') result.ok = false;
            }
        }

        // (b) upstream master, early warning only
        const msha = fetchUpstream(repo, url, masterRef);
        if (msha) {
            result.master.sha = msha;
            const a = applyQueue(repo, work, 'master', msha, queue, gitEnv);
            Object.assign(result.master, { status: a.status, applied: a.applied, total: a.total, conflict: a.conflict });
            removeWorktree(repo, a.wt);
        } else result.master.status = 'unavailable';
    } catch (e) {
        result.ok = false;
        result.error = e.message;
    } finally {
        for (const wt of keep) removeWorktree(repo, wt);
        tryGit(repo, ['worktree', 'prune']);
        fs.rmSync(work, { recursive: true, force: true });
        result.elapsedSeconds = Math.round((Date.now() - started) / 1000);
        fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    }
    const t = result.tag;
    if (result.error) console.log(`::error::${result.error}`);
    else if (!t.isNew) console.log(`no new upstream tag (newest ${t.ref}, base ${result.baseTag})`);
    else if (t.status === 'conflict') console.log(`::error::patch ${t.conflict.index}/${t.total} (${t.conflict.patch.id} ${t.conflict.patch.sha}) does not apply onto ${t.ref}: ${t.conflict.files.join(', ') || 'no file list'}`);
    else console.log(`queue applies cleanly onto ${t.ref}; build ${result.build.status}${result.build.artifact ? '; artifact ' + result.build.artifact : ''}`);
    if (result.master.status === 'conflict') console.log(`::warning::upstream ${masterRef} early warning: patch ${result.master.conflict.patch.id} conflicts in ${result.master.conflict.files.join(', ')}`);
    console.log(`result: ${path.join(outDir, 'result.json')}`);
    return result;
}

if (require.main === module) {
    const r = main();
    process.exit(r.ok ? 0 : 1);
}

module.exports = { parseSemver, cmpSemver, newestStableTag, baseTagFromBranch, main };
