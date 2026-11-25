// Pack-time stamp for the patched build. Never run against the source tree in a commit.
// Usage: node scripts/bt-stamp.js <N>   (writes version <upstream>-bt.<N> and a "brighttest" stamp
// into package.json of the CURRENT directory; run it in a CI checkout or a scratch copy).
// Needs the git history of the queue branch and the upstream release tag v<upstream>.
// Stamp contents, all computed here at pack time:
//   queue   the current branch name (so a branch rename needs no change here)
//   patches BT-Patch trailers of the queue commits since the upstream tag (ROO-90 is local-only, left out)
//   flags   the complete list of CLI flags the build accepts: the base's `coverage-dir` plus the BT-Flag
//           trailers of the queue commits, plus PATCH_FLAGS for patches whose commits carry no trailer
//   pinned  exact versions written into the packed package.json only (source tree keeps upstream's range)
const fs = require('fs');
const cp = require('child_process');

// Flag the base build already has. Consumers treat `flags` as the only answer, so it must be listed.
const BASE_FLAGS = ['coverage-dir'];

// Flags of patches whose commits carry no BT-Flag trailer (history is not rewritten). A BT-Flag
// trailer on any commit of the same patch wins over this map.
const PATCH_FLAGS = {
    'ROO-01': ['app-exit-grace'], // 02d80e7 "feat(cli): add opt-in --app-exit-grace (ROO-01)"; fix 00c41f6
    'ROO-02': ['idle-timeout'], // 8a302b6 "feat(cli): add opt-in --idle-timeout (ROO-02)"
    'ROO-03': ['continue-on-runtime-error'] // ad3ceff "feat(cli): add opt-in --continue-on-runtime-error (ROO-03)"
};

// Dependencies pinned to the version in package-lock.json in the packed package.json only.
const PIN = ['roku-deploy'];

function fail(msg) {
    console.error(msg);
    process.exit(1);
}

function git(args) {
    return cp.execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const n = parseInt(process.argv[2], 10);
if (!(n >= 1)) {
    fail('usage: node scripts/bt-stamp.js <N>');
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const upstream = pkg.version.replace(/-bt\.\d+$/, '');

let queue;
try {
    queue = git(['rev-parse', '--abbrev-ref', 'HEAD']);
} catch (e) {
    fail(`cannot read the branch name: ${e.message.split('\n')[0]}`);
}
if (!queue || queue === 'HEAD') {
    fail('detached HEAD: check out the queue branch (bt/...) before stamping');
}

// One record per commit since the upstream tag: its BT-Patch and BT-Flag trailers. The early ROO-01..03
// commits have no BT-Patch trailer, so a trailing "(ROO-nn)" in the subject also names the patch.
let log;
try {
    log = git(['log', `v${upstream}..HEAD`, '--format=%x1e%s%x1f%(trailers:key=BT-Patch,key=BT-Flag,separator=%x1f)']);
} catch (e) {
    fail(`cannot read commits since v${upstream} (is the tag fetched?): ${e.message.split('\n')[0]}`);
}
const patches = {};
const trailerFlags = {};
for (const rec of log.split('\x1e')) {
    let id;
    const flags = [];
    const subject = /\((ROO-\d+)\)\s*$/.exec(rec.split('\x1f')[0].trim());
    if (subject) {
        id = subject[1];
    }
    for (const line of rec.split(/[\x1f\n]/)) {
        const m = /^(BT-Patch|BT-Flag):\s*(.+?)\s*$/.exec(line.trim());
        if (!m) {
            continue;
        }
        if (m[1] === 'BT-Patch') {
            id = m[2];
        } else {
            flags.push(...m[2].split(/[\s,]+/).map(f => f.replace(/^--/, '')).filter(Boolean));
        }
    }
    if (id && id !== 'ROO-90') {
        patches[id] = 1;
        trailerFlags[id] = (trailerFlags[id] || []).concat(flags);
    }
}
const flags = [...BASE_FLAGS];
for (const id of Object.keys(patches).sort()) {
    const own = trailerFlags[id].length ? trailerFlags[id] : (PATCH_FLAGS[id] || []);
    for (const f of own) {
        if (!flags.includes(f)) {
            flags.push(f);
        }
    }
}

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const pinned = {};
for (const name of PIN) {
    const entry = lock.packages && lock.packages[`node_modules/${name}`];
    if (!entry || !entry.version) {
        fail(`package-lock.json has no resolved version for ${name}`);
    }
    pinned[name] = entry.version;
    pkg.dependencies[name] = entry.version;
}

pkg.version = `${upstream}-bt.${n}`;
pkg.brighttest = {
    upstream: `rooibos-roku@${upstream}`,
    queue: queue,
    build: `v${upstream}-bt.${n}`,
    patches: patches,
    flags: flags,
    pinned: pinned,
    nonDevice: []
};
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 4) + '\n');
console.log(`stamped ${pkg.name}@${pkg.version} (queue ${queue}, flags ${flags.join(',')}, pinned ${JSON.stringify(pinned)})`);
