import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// The package's own few primitives, plain elements so it needs no UI library and never imports an
// app's components. They use the shadcn theme token names (bg-primary, bg-muted, ...) the apps define.
import { useEffect, useState } from 'react';
/** Joins class names, leaving out the falsy ones. No tailwind-merge: a class passed in is added, not swapped for a conflicting one. */
export function cn(...parts) {
    return parts.filter(Boolean).join(' ');
}
const VARIANTS = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/80',
    outline: 'border-border bg-background hover:bg-muted',
    ghost: 'hover:bg-muted',
    destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
};
export function Button({ className, variant = 'outline', type = 'button', ...props }) {
    return (_jsx("button", { type: type, className: cn('inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-transparent px-2.5 text-[0.8rem] font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50', VARIANTS[variant], className), ...props }));
}
const FIELD = 'h-7 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm transition-colors outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50';
export function Input({ className, ...props }) {
    return _jsx("input", { className: cn(FIELD, className), ...props });
}
/** A small labelled field. */
export function Field({ label, htmlFor, children, className }) {
    return (_jsxs("div", { className: cn('flex flex-col gap-1', className), children: [_jsx("label", { htmlFor: htmlFor, className: "text-xs text-muted-foreground", children: label }), children] }));
}
/** An action's error, shown where the action is. */
export function ErrorNote({ error, className }) {
    if (!error)
        return null;
    return (_jsx("p", { role: "alert", className: cn('text-sm text-destructive', className), children: error }));
}
/** Quiet text: loading, empty lists, what an action does. Not a live region, so many rows stay silent. */
export function Hint({ children, className }) {
    return _jsx("p", { className: cn('text-sm text-muted-foreground', className), children: children });
}
/** The outcome of an action, e.g. what giving up on a charge found; read out when it appears. */
export function Note({ children, className }) {
    return (_jsx("p", { role: "status", className: cn('text-sm text-muted-foreground', className), children: children }));
}
/**
 * An action that moves money or can't be undone asks once more: the first click turns the button
 * red with `confirmLabel`, the second runs `onConfirm`. Leaving the button disarms it. `onConfirm`
 * shows its own errors (the page's actions go through useSaver, which never rejects).
 */
export function ConfirmButton({ children, confirmLabel, onConfirm, disabled }) {
    const [armed, setArmed] = useState(false);
    // Safari and Firefox on macOS don't focus a clicked button, so it may never blur; disarm after a while too.
    useEffect(() => {
        if (!armed)
            return undefined;
        const timer = setTimeout(() => setArmed(false), 8000);
        return () => clearTimeout(timer);
    }, [armed]);
    // One button whose label changes, announced politely so a screen reader hears the question.
    return (_jsx(Button, { variant: armed ? 'destructive' : 'outline', "aria-live": "polite", disabled: disabled, onClick: () => {
            if (!armed)
                return setArmed(true);
            setArmed(false);
            void onConfirm();
        }, onBlur: () => setArmed(false), children: armed ? confirmLabel : children }));
}
/** A titled part of the page. */
export function Section({ title, hint, children }) {
    return (_jsxs("section", { className: "flex flex-col gap-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-base font-semibold", children: title }), hint && _jsx("p", { className: "text-sm text-muted-foreground", children: hint })] }), children] }));
}
/** A bordered list of rows. */
export function Rows({ children }) {
    return _jsx("ul", { className: "flex flex-col divide-y rounded-xl ring-1 ring-foreground/10", children: children });
}
//# sourceMappingURL=ui.js.map