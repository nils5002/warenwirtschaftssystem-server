/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
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
      },
      boxShadow: {
        soft: '0 12px 32px rgba(15, 23, 42, 0.08)',
        panel: '0 18px 45px rgba(15, 23, 42, 0.12)',
      },
      borderRadius: {
        xl2: '1.1rem',
      },
    },
  },
  plugins: [],
};
