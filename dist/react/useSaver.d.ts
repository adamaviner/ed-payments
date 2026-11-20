/**
 * Runs one row's actions one at a time, keeping the last error to show next to them. A second action
 * while one is running is ignored, checked on a ref rather than on `busy`, because two clicks in the
 * same tick both see the old state and a doubled refund request would ask for the money twice.
 * `run` resolves to whether it ran and succeeded.
 */
export declare function useSaver(): {
    error: string | null;
    run: (fn: () => Promise<unknown>) => Promise<boolean>;
    clear: () => void;
    busy: boolean;
};
//# sourceMappingURL=useSaver.d.ts.map