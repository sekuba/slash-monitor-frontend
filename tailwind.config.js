/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand colors from guide
        'whisper-white': '#F2EEE1',
        'brand-black': '#1A1400',
        'chartreuse': '#D4FF28',
        'orchid': '#ff2df4',
        'aqua': '#2bfae9',
        'vermillion': '#FF1A1A',
        'malachite': '#001f18',
        'aubergine': '#2e0026',
        'lapis': '#00122e',
        'oxblood': '#2e0700',
      },
      boxShadow: {
        'brutal': '6px 6px 0px #1A1400',
        'brutal-lg': '10px 10px 0px #1A1400',
        'brutal-xl': '15px 15px 0px #1A1400',
        'brutal-aqua': '6px 6px 0px #2bfae9',
        'brutal-chartreuse': '6px 6px 0px #D4FF28',
        'brutal-vermillion': '6px 6px 0px #FF1A1A',
        'brutal-orchid': '6px 6px 0px #ff2df4',
      },
      borderWidth: {
        '3': '3px',
        '5': '5px',
        '6': '6px',
      },
    },
  },
  plugins: [],
}
