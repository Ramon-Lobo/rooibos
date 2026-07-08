#!/usr/bin/env node
'use strict';
// roku-test overrides: lay patched copies of ropm-managed framework files over the ones `ropm copy`
// pulls in, so the fixes ship in the built dist. Run in the build AFTER `ropm copy` and BEFORE
// `copy-framework-files`, i.e. `ropm copy && node scripts/apply-roku-test-overrides.js && ...`.
//
// Currently overrides:
//   rooibos_promises/promises.brs — settle promises synchronously. brs-node rejects observeFieldScoped
//   registered with an anonymous callback, so the observer-based notification never fires headless and
//   promise chains (which back Rooibos @SGNode node tests) never settle. This file notifies listeners
//   directly from resolve/reject/on. promises.brs comes from the @rokucommunity/promises ropm
//   dependency, not this repo's own source, hence the override rather than an in-place edit.
const fs = require('fs');
const path = require('path');

const overridesDir = path.join(__dirname, 'roku-test-overrides');
const frameworkSrc = path.join(__dirname, '..', 'framework', 'src', 'source');

const overrides = [
  {
    from: 'rooibos_promises__promises.brs',
    to: path.join(frameworkSrc, 'roku_modules', 'rooibos_promises', 'promises.brs'),
  },
];

for (const o of overrides) {
  const src = path.join(overridesDir, o.from);
  if (!fs.existsSync(o.to)) {
    console.warn(`[roku-test-overrides] target missing (did 'ropm copy' run?): ${o.to}`);
    continue;
  }
  fs.copyFileSync(src, o.to);
  console.log(`[roku-test-overrides] applied ${o.from} -> ${path.relative(path.join(__dirname, '..'), o.to)}`);
}
