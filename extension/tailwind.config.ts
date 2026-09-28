import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./entrypoints/**/*.{ts,tsx,html}', './utils/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f9fafc',
        card: '#ffffff',
        foreground: '#141822',
        'muted-foreground': '#5e636e',
        muted: '#f2f3f7',
        border: '#e1e3e7',
        primary: '#524fdd',
        'primary-soft': '#eaedff',
        'primary-ink': '#423ebb',
        destructive: '#d01c29',
        success: '#1a8a51',
        'phase-0': '#8459c3',
        'phase-1': '#cf7c00',
        'phase-2': '#0e9254',
        'phase-3': '#d33949',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
