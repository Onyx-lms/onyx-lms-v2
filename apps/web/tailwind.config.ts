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
      colors: {
        brand: {
          50:  '#F0F7F9',
          100: '#D7E9EE',
          200: '#B4D5DE',
          300: '#8ABCCC',
          400: '#5A9CB2',
          500: '#307890', // logo teal
          600: '#1F5F75', // primary — 7.11:1 on white
          700: '#17505F',
          800: '#113E4A',
          900: '#0B2F3A',
        },
        accent: {
          50:  '#FEF6EC',
          100: '#FCE9CE',
          200: '#F8D3A2',
          400: '#EE9B3C',
          500: '#D87818', // logo orange — fills only
          600: '#B45309',
          700: '#9A4508', // 5.71:1 — safe for text on the peach card
        },
        ink:   '#0F172A',
        muted: '#5C6B7E',
        // Decorative marks only -- dots, rules, disabled glyphs. It does not
        // clear 4.5:1 and must never carry text; `text-faint` was tried on
        // the profile page's "of 20" labels and failed axe on five nodes.
        // Anything with words in it uses `muted`.
        faint: '#6E7D8F',
        line:  '#E2E8F0',
        canvas: '#F6F8FA',
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
