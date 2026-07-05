/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // WICHTIG: 'class' statt Default 'media' — der Theme-Toggle der App setzt
  // die .dark-Klasse auf <html>. Ohne dieses Setting würden alle dark:-
  // Varianten am OS-Farbschema hängen und den Toggle ignorieren.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ebf8ff',
          100: '#d9f1ff',
          200: '#b5e6ff',
          300: '#7ed7ff',
          400: '#36b8f4',
          500: '#1099d6',
          600: '#0c7eaf',
          700: '#0b658c',
          800: '#0d5674',
          900: '#124861',
        },
        // UI-V2 Design-Tokens (CSS-Variablen in index.css, je Light/Dark).
        // Verwendung: bg-canvas, bg-surface, bg-surface-2, border-line,
        // text-ink, text-ink-muted, bg-primary, ...
        canvas: 'var(--ui-bg)',
        surface: {
          DEFAULT: 'var(--ui-surface)',
          2: 'var(--ui-surface-2)',
        },
        line: {
          DEFAULT: 'var(--ui-border)',
          strong: 'var(--ui-border-strong)',
        },
        ink: {
          DEFAULT: 'var(--ui-text)',
          muted: 'var(--ui-text-muted)',
          faint: 'var(--ui-text-faint)',
        },
        primary: {
          DEFAULT: 'var(--ui-primary)',
          hover: 'var(--ui-primary-hover)',
          soft: 'var(--ui-primary-soft)',
        },
      },
      boxShadow: {
        // Geschichteter Card-Schatten: eine feine Kontakt-/Hairline-Ebene für
        // klare Kanten auf dem getönten Body + eine weiche Tiefe für die
        // Schwebe. Wirkt deutlich "geerdeter" und hochwertiger als der reine
        // Streuschatten zuvor (war: 0 12px 32px /0.08).
        soft: '0 1px 2px 0 rgba(15, 23, 42, 0.05), 0 10px 28px -6px rgba(15, 23, 42, 0.10)',
        panel: '0 4px 10px -2px rgba(15, 23, 42, 0.08), 0 18px 45px -8px rgba(15, 23, 42, 0.16)',
      },
      borderRadius: {
        xl2: '1.1rem',
      },
    },
  },
  plugins: [],
};
