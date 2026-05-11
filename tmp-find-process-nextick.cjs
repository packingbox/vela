const fs = require('fs');
const path = require('path');
const lockPath = path.resolve('pnpm-lock.yaml');
const txt = fs.readFileSync(lockPath, 'utf8');
console.log('lock contains process-nextick-args:', txt.includes('process-nextick-args'));
const root = path.resolve('node_modules');
let found = false;
function walk(dir) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.name === '.pnpm') continue;
    const p = path.join(dir, name.name);
    if (name.isDirectory()) {
      walk(p);
    } else if (name.name === 'package.json' && path.basename(path.dirname(p)) === 'process-nextick-args') {
      found = true;
      console.log('module package', path.dirname(p));
    }
  }
}
try {
  walk(root);
} catch (e) {
  console.error('walk err', e.message);
}
console.log('found', found);
