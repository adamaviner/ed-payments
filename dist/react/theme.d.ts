import type { StripeAppearance } from './stripe.js';
import type { PaypalFieldStyle } from './vault.js';
/** The names of the app's CSS custom properties to read, e.g. `'--background'`. */
export interface PageColors {
    background: string;
    text: string;
    mutedText: string;
    primary: string;
    danger: string;
    border: string;
    /** Passed to Stripe as written (e.g. 0.625rem): a length, not a colour. */
    radius?: string;
}
/** What to give the Stripe forms (`appearance`) and PayPal's card fields (`style`). */
export interface PageTheme {
    dark: boolean;
    stripe: StripeAppearance;
    paypal: PaypalFieldStyle;
}
/** Reads the page's colours now. On the server, or when they can't be read, Stripe's own theme. */
export declare function pageTheme(vars: PageColors): PageTheme;
/**
 * The page's theme for the payment fields. Looked at again whenever the class, style or data-theme of
 * <html>, the stylesheets in <head> (a code-split route's CSS arriving, a dev server's injected styles)
 * or the system's dark setting change; painted again only when the variables or the hint differ, since
 * some libraries change <html> while scrolling. Undefined while rendering on the server, where there is
 * no page; the browser's first render fills it in before Stripe's frame is made.
 */
export declare function usePageTheme(vars: PageColors): PageTheme | undefined;
//# sourceMappingURL=theme.d.ts.map