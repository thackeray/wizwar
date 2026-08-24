/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'wizwar-bg': '#1e293b',
        'wizwar-panel': '#0f172a',
        'wizwar-border': '#475569',
        'wizwar-highlight': '#22d3ee',
        'wizwar-current': '#facc15',
      },
    },
  },
  plugins: [],
}