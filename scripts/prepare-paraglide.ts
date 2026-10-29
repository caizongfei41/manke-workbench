import { compile } from '@inlang/paraglide-js';

import { paraglideCompilerOptions } from '../src/config/paraglide';

/**
 * Compile the message catalog.
 *
 * project.inlang/settings.json points its module list at a jsdelivr CDN URL.
 * That makes the compile depend on outbound network, and when the CDN is
 * unreachable the error surfaces in the middle of `pnpm build` inside the
 * updater, where it reads as "update failed" instead of what it is:
 *
 *   PluginImportError: Couldn't import the plugin
 *   "https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@..."
 *
 * The compiled output is committed under src/paraglide and only changes when
 * messages/*.json change. If the plugin cannot be fetched, the previous output
 * is still valid for every string that did not change -- so the right move is
 * to warn clearly and continue, not to abort a build the user cannot fix from
 * inside the app.
 */
try {
  await compile(paraglideCompilerOptions);
  console.log('  paraglide: 编译完成');
} catch (error) {
  const message = String(error);
  const isNetwork =
    message.includes('PluginImportError') ||
    message.includes('fetch failed') ||
    message.includes('ENOTFOUND') ||
    message.includes('ETIMEDOUT');

  if (!isNetwork) throw error;

  console.warn('');
  console.warn('  paraglide: 取不到 message-format 插件（网络问题）');
  console.warn('  沿用 src/paraglide 里上一次的编译结果。');
  console.warn('  如果这次改动过 messages/*.json，那些新文案不会生效。');
  console.warn('  联网后重跑 `pnpm build` 即可。');
  console.warn('');
}
