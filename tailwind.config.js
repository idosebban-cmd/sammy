/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ['"Fraunces"', "Georgia", "serif"],
      },
      colors: {
        sage: {
          50: "#f3f7f4", 100: "#e3ede6", 200: "#c7dbcd", 300: "#a0c1aa", 400: "#74a183",
          500: "#548466", 600: "#416a51", 700: "#355543", 800: "#2c4537", 900: "#25392e",
        },
        sand: {
          50: "#fbfaf7", 100: "#f5f2ec", 200: "#ebe5da", 300: "#dcd2c2", 400: "#c4b49c",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(31, 41, 35, 0.04), 0 4px 16px rgba(31, 41, 35, 0.05)",
      },
    },
  },
  plugins: [],
};
