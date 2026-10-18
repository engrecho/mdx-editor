const esbuild = require('esbuild');
const path = require('path');

const R = path.join(__dirname, '../src/renderer');

esbuild.build({
  entryPoints: [path.join(R, 'app.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  outfile: path.join(R, 'app.bundle.js'),
  minify: false,
  legalComments: 'none',
  logLevel: 'info'
}).then(() => {
  console.log('✓ renderer bundle built');
}).catch(e => {
  console.error(e);
  process.exit(1);
});