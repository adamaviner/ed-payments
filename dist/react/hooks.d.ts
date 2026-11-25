/**
 * A ref that always holds the latest value, for callbacks handed to a processor's SDK once (buttons
 * rendered once per order, fields once per style), so they never call a stale prop.
 */
export declare function useLatest<T>(value: T): import("react").RefObject<T>;
/**
 * Runs one submit at a time. The check is on a ref, not on `busy`: two clicks in the same tick both
 * see the old state, and a second submit could pay or save twice (useSaver does the same).
 */
export declare function useOneAtATime(): {
    busy: boolean;
    run: (fn: () => Promise<void>) => Promise<void>;
};
//# sourceMappingURL=hooks.d.ts.map