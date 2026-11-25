import { ConvexError } from 'convex/values';
/** A message fit to show an admin: the ConvexError's own message, else the Error's, else `fallback`. */
export function errorMessage(err, fallback = 'Something went wrong.') {
    if (err instanceof ConvexError) {
        const data = err.data;
        return typeof data === 'string' ? data : (data?.message ?? fallback);
    }
    if (!(err instanceof Error) || !err.message)
        return fallback;
    // Uncaught server errors arrive as "[CONVEX M(fn)] [Request ID: …] Server Error\nUncaught Error: <message>\n  at …".
    return err.message.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0] || fallback;
}
//# sourceMappingURL=errors.js.map