#!/usr/bin/env node
// npx ed-payments webhooks --stripe <url> | --paypal <url> [--env-file .env.local] [--extra-events a,b] [--dry-run] [--remove] [--live]
//
// Registers the app's webhook at the processor with exactly the events the library handles (or
// updates one already at that address, or removes it). Keys come from the environment or the env
// file: STRIPE_SECRET_KEY; PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_API_BASE. Live keys need --live.
import { readFileSync } from 'node:fs';
import { PAYPAL_LIVE_API, PAYPAL_SANDBOX_API } from '../core/paypal.js';
import { paypalWebhook, stripeWebhook } from './webhooks.js';
const USAGE = 'Usage: npx ed-payments webhooks (--stripe <url> | --paypal <url>) [--env-file <file>] [--extra-events a,b] [--dry-run] [--remove] [--live]';
function parse(argv) {
    const flags = new Map();
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--'))
            continue;
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            flags.set(a.slice(2), next);
            i++;
        }
        else
            flags.set(a.slice(2), true);
    }
    return flags;
}
function readEnvFile(file) {
    return Object.fromEntries(readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l))
        .filter((m) => m !== null)
        .map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]));
}
const str = (x) => (typeof x === 'string' ? x : undefined);
async function main(argv) {
    const [command, ...rest] = argv;
    const flags = parse(rest);
    if (command !== 'webhooks') {
        console.error(USAGE);
        return 2;
    }
    const envFile = str(flags.get('env-file'));
    const env = { ...process.env, ...(envFile ? readEnvFile(envFile) : {}) };
    const stripeUrl = str(flags.get('stripe'));
    const paypalUrl = str(flags.get('paypal'));
    const url = stripeUrl ?? paypalUrl;
    if (!url || (stripeUrl && paypalUrl) || !/^https:\/\//.test(url)) {
        console.error(`${USAGE}\nGive one https:// address, e.g. https://<deployment>.convex.site/stripe/webhook.`);
        return 2;
    }
    const run = {
        url,
        fetch: (input, init) => fetch(input, init),
        extraEvents: str(flags.get('extra-events'))
            ?.split(',')
            .map((e) => e.trim())
            .filter(Boolean),
        dryRun: flags.has('dry-run'),
        remove: flags.has('remove'),
        live: flags.has('live'),
    };
    let result;
    if (stripeUrl) {
        const key = env.STRIPE_SECRET_KEY;
        if (!key)
            throw new Error('STRIPE_SECRET_KEY isn’t set (in the environment or --env-file).');
        result = await stripeWebhook(key, run);
    }
    else {
        const clientId = env.PAYPAL_CLIENT_ID;
        const clientSecret = env.PAYPAL_CLIENT_SECRET;
        if (!clientId || !clientSecret)
            throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET aren’t set (in the environment or --env-file).');
        const apiBase = (env.PAYPAL_API_BASE || PAYPAL_SANDBOX_API).replace(/\/+$/, '');
        if (apiBase !== PAYPAL_LIVE_API && apiBase !== PAYPAL_SANDBOX_API)
            throw new Error(`PAYPAL_API_BASE must be ${PAYPAL_LIVE_API} or ${PAYPAL_SANDBOX_API}.`);
        result = await paypalWebhook({ clientId, clientSecret, apiBase }, run);
    }
    console.info(`${stripeUrl ? 'Stripe' : 'PayPal'} webhook ${url}: ${result.action}${result.id ? ` (${result.id})` : ''}`);
    for (const n of result.notes)
        console.info(`  ${n}`);
    return 0;
}
main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
//# sourceMappingURL=index.js.map