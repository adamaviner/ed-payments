import { useCallback, useRef, useState } from 'react';
import { errorMessage } from './errors.js';
/**
 * Runs one row's actions one at a time, keeping the last error to show next to them. A second action
 * while one is running is ignored, checked on a ref rather than on `busy`, because two clicks in the
 * same tick both see the old state and a doubled refund request would ask for the money twice.
 * `run` resolves to whether it ran and succeeded.
 */
export function useSaver() {
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const running = useRef(false);
    const run = useCallback(async (fn) => {
        if (running.current)
            return false;
        running.current = true;
        setBusy(true);
        setError(null);
        try {
            await fn();
            return true;
        }
        catch (err) {
            setError(errorMessage(err));
            return false;
        }
        finally {
            running.current = false;
            setBusy(false);
        }
    }, []);
    const clear = useCallback(() => setError(null), []);
    return { error, run, clear, busy };
}
//# sourceMappingURL=useSaver.js.map