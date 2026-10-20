import {cloudflareTest} from '@cloudflare/vitest-plugin';
import {defineConfig} from 'vitest/config';
import {randomBytes} from 'node:crypto';
export default defineConfig({plugins:[cloudflareTest({wrangler:{configPath:'./wrangler.jsonc'},miniflare:{bindings:{ADMIN_TOKEN:randomBytes(32).toString('hex')}}})],test:{include:['test/**/*.test.js'],fileParallelism:false}});
