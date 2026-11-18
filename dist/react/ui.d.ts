import { type ComponentProps, type ReactNode } from 'react';
/** Joins class names, leaving out the falsy ones. No tailwind-merge: a class passed in is added, not swapped for a conflicting one. */
export declare function cn(...parts: (string | false | null | undefined)[]): string;
declare const VARIANTS: {
    default: string;
    outline: string;
    ghost: string;
    destructive: string;
};
export type ButtonProps = ComponentProps<'button'> & {
    variant?: keyof typeof VARIANTS;
};
export declare function Button({ className, variant, type, ...props }: ButtonProps): import("react").JSX.Element;
export declare function Input({ className, ...props }: ComponentProps<'input'>): import("react").JSX.Element;
/** A small labelled field. */
export declare function Field({ label, htmlFor, children, className }: {
    label: string;
    htmlFor: string;
    children: ReactNode;
    className?: string;
}): import("react").JSX.Element;
/** An action's error, shown where the action is. */
export declare function ErrorNote({ error, className }: {
    error: string | null | undefined;
    className?: string;
}): import("react").JSX.Element | null;
/** Quiet text: loading, empty lists, what an action does. Not a live region, so many rows stay silent. */
export declare function Hint({ children, className }: {
    children: ReactNode;
    className?: string;
}): import("react").JSX.Element;
/** The outcome of an action, e.g. what giving up on a charge found; read out when it appears. */
export declare function Note({ children, className }: {
    children: ReactNode;
    className?: string;
}): import("react").JSX.Element;
/**
 * An action that moves money or can't be undone asks once more: the first click turns the button
 * red with `confirmLabel`, the second runs `onConfirm`. Leaving the button disarms it. `onConfirm`
 * shows its own errors (the page's actions go through useSaver, which never rejects).
 */
export declare function ConfirmButton({ children, confirmLabel, onConfirm, disabled }: {
    children: ReactNode;
    confirmLabel: ReactNode;
    onConfirm: () => Promise<unknown>;
    disabled?: boolean;
}): import("react").JSX.Element;
/** A titled part of the page. */
export declare function Section({ title, hint, children }: {
    title: string;
    hint?: ReactNode;
    children: ReactNode;
}): import("react").JSX.Element;
/** A bordered list of rows. */
export declare function Rows({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=ui.d.ts.map