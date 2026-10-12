/* Loads the browser scripts into a Node global, for tests. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
for (const f of ['color', 'fields', 'generate', 'importer', 'tools', 'presets']) {
  const p = path.join(root, 'js', f + '.js');
  if (fs.existsSync(p)) vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
}
module.exports = globalThis.PG;
