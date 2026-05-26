/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Slate-blue primary palette
        primary: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          500: '#4f6eb4',
          600: '#3d5a9e',
          700: '#2d4580',
          800: '#1e2f5c',
          900: '#111c3a',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
