/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Match the landing HTML palette exactly.
        parchment: '#F8F5EF',
        hero:      '#F3F0E8',
        card:      '#FCFAF6',
        ink:       '#15130F',
        mut:       '#5B574E',
        line:      '#DFDACE',
        accent:    '#9B1F1F',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'JetBrains Mono', 'ui-monospace', 'monospace'],
        serif: ['Newsreader', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
