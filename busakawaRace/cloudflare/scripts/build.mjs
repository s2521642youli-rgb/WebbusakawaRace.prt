import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
await build({stdin:{contents:"export {toCanvas} from 'qrcode';",resolveDir:process.cwd()},outfile:'public/vendor/qr-code.js',bundle:true,format:'esm',platform:'browser',minify:true,legalComments:'eof'});
await copyFile('node_modules/qrcode/license','public/vendor/qrcode-LICENSE.txt');
