const { copyFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const target = join(__dirname, '../public');
mkdirSync(target, { recursive: true });
copyFileSync(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'), join(target, 'pdf.worker.min.mjs'));
