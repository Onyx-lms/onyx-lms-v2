import type { Config } from 'tailwindcss';

/**
 * The palette is sampled from the actual logo mark, not invented.
 *
 * `brand` was a generic blue (#2b57c4) with no relationship to the Onyx logo,
 * which is teal (#307890) and orange (#D87818) -- so every button in the
 * product disagreed with the wordmark above it. These scales are built around
 * the sampled values.
 *
 * Contrast is what fixed the roles. Measured against white:
 *   brand-600 #1F5F75 -> 7.11:1  passes AA comfortably, so it carries every
 *                                interactive element: buttons, links, focus.
 *   accent    #D87818 -> 3.17:1  FAILS AA for body text. It is a fill colour
 *                                only -- progress bars, streak rings, large
 *                                numerals -- and never small text on white.
 *   accent-ink #9A4508 ->5.71:1  the one to use when orange must carry text.
 *
 * `muted` is the trap worth naming: #64748B is 4.76:1 on white but only
 * 4.47:1 on the page background (#F6F8FA), i.e. a real AA failure everywhere
 * it sat on the page rather than inside a card. The value here clears both.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /*
       * Every colour resolves through a CSS variable holding space-separated
       * RGB channels, with the defaults in globals.css set to exactly the hex
       * values that used to be written here. Nothing changes appearance from
       * this alone -- what it buys is a re-skin that costs one block of
       * variables instead of a rewrite of every className in the product.
       *
       * The channel form (`31 95 117`) rather than a hex string is what lets
       * Tailwind's alpha modifiers keep working: `bg-brand-50/40` compiles to
       * `rgb(var(--c-brand-50) / 0.4)`, which a hex variable cannot express.
       *
       * See `[data-skin='console']` in globals.css for the administrator's skin.
       */
      colors: {
        brand: {
          50:  'rgb(var(--c-brand-50) / <alpha-value>)',
          100: 'rgb(var(--c-brand-100) / <alpha-value>)',
          200: 'rgb(var(--c-brand-200) / <alpha-value>)',
          300: 'rgb(var(--c-brand-300) / <alpha-value>)',
          400: 'rgb(var(--c-brand-400) / <alpha-value>)',
          500: 'rgb(var(--c-brand-500) / <alpha-value>)',
          600: 'rgb(var(--c-brand-600) / <alpha-value>)',
          700: 'rgb(var(--c-brand-700) / <alpha-value>)',
          800: 'rgb(var(--c-brand-800) / <alpha-value>)',
          900: 'rgb(var(--c-brand-900) / <alpha-value>)',
        },
        accent: {
          50:  'rgb(var(--c-accent-50) / <alpha-value>)',
          100: 'rgb(var(--c-accent-100) / <alpha-value>)',
          200: 'rgb(var(--c-accent-200) / <alpha-value>)',
          400: 'rgb(var(--c-accent-400) / <alpha-value>)',
          500: 'rgb(var(--c-accent-500) / <alpha-value>)',
          600: 'rgb(var(--c-accent-600) / <alpha-value>)',
          700: 'rgb(var(--c-accent-700) / <alpha-value>)',
        },
        ink:    'rgb(var(--c-ink) / <alpha-value>)',
        muted:  'rgb(var(--c-muted) / <alpha-value>)',
        faint:  'rgb(var(--c-faint) / <alpha-value>)',
        line:   'rgb(var(--c-line) / <alpha-value>)',
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
      },
      fontFamily: {
        // The skin supplies a display face; everywhere else inherits the
        // stack the body already had.
        display: 'var(--font-display, inherit)',
      },
      borderRadius: { xl2: '1.25rem' },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,.06)',
        lift: '0 12px 32px rgba(31,95,117,.18)',
      },
    },
  },
  plugins: [],
} satisfies Config;
