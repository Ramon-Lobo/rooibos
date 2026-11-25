// Pack-time stamp for the patched build. Never run against the source tree in a commit.
// Usage: node scripts/bt-stamp.js <N>   (writes version <upstream>-bt.<N> and a "brighttest" stamp
// into package.json of the CURRENT directory; run it in a CI checkout or a scratch copy).
const fs = require('fs');
const n = parseInt(process.argv[2], 10);
if (!(n >= 1)) {
    console.error('usage: node scripts/bt-stamp.js <N>');
    process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const upstream = pkg.version.replace(/-bt\.\d+$/, '');
pkg.version = `${upstream}-bt.${n}`;
pkg.brighttest = {
    upstream: `rooibos-roku@${upstream}`,
    queue: `bt/${upstream}`,
    build: `v${upstream}-bt.${n}`,
    patches: { 'ROO-01': 1, 'ROO-02': 1, 'ROO-03': 1, 'ROO-04': 1, 'ROO-05': 1 },
    nonDevice: []
};
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 4) + '\n');
console.log(`stamped ${pkg.name}@${pkg.version}`);
