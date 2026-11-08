import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          active: "hsl(var(--primary-active))",
          subtle: "hsl(var(--primary-subtle))",
          "subtle-foreground": "hsl(var(--primary-subtle-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
          solid: "hsl(var(--secondary-solid))",
          "solid-hover": "hsl(var(--secondary-solid-hover))",
          "solid-active": "hsl(var(--secondary-solid-active))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          strong: "hsl(var(--success-strong))",
          "strong-hover": "hsl(var(--success-strong-hover))",
          foreground: "hsl(var(--success-foreground))",
          subtle: "hsl(var(--success-subtle))",
          "subtle-foreground": "hsl(var(--success-subtle-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          strong: "hsl(var(--warning-strong))",
          "strong-hover": "hsl(var(--warning-strong-hover))",
          foreground: "hsl(var(--warning-foreground))",
          subtle: "hsl(var(--warning-subtle))",
          "subtle-foreground": "hsl(var(--warning-subtle-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          strong: "hsl(var(--info-strong))",
          "strong-hover": "hsl(var(--info-strong-hover))",
          foreground: "hsl(var(--info-foreground))",
          subtle: "hsl(var(--info-subtle))",
          "subtle-foreground": "hsl(var(--info-subtle-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          hover: "hsl(var(--destructive-hover))",
          subtle: "hsl(var(--destructive-subtle))",
          "subtle-foreground": "hsl(var(--destructive-subtle-foreground))",
        },
        surface: {
          DEFAULT: "hsl(var(--surface))",
          foreground: "hsl(var(--surface-foreground))",
        },
        link: {
          DEFAULT: "hsl(var(--link))",
          hover: "hsl(var(--link-hover))",
        },
        table: {
          header: "hsl(var(--table-header-bg))",
          "header-foreground": "hsl(var(--table-header-foreground))",
          row: {
            hover: "hsl(var(--table-row-hover))",
            selected: "hsl(var(--table-row-selected))",
          },
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          active: "hsl(var(--sidebar-active))",
          "active-foreground": "hsl(var(--sidebar-active-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        pill: "var(--radius-pill)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        display: ["var(--text-display)", { lineHeight: "var(--text-display--line-height)" }],
        heading: ["var(--text-heading)", { lineHeight: "var(--text-heading--line-height)" }],
        subheading: [
          "var(--text-subheading)",
          { lineHeight: "var(--text-subheading--line-height)" },
        ],
        body: ["var(--text-body)", { lineHeight: "var(--text-body--line-height)" }],
        label: ["var(--text-label)", { lineHeight: "var(--text-label--line-height)" }],
        caption: ["var(--text-caption)", { lineHeight: "var(--text-caption--line-height)" }],
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        dropdown: "var(--shadow-dropdown)",
        modal: "var(--shadow-modal)",
        focus: "var(--shadow-focus)",
        "focus-danger": "var(--shadow-focus-danger)",
      },
      spacing: {
        gutter: "var(--page-gutter)",
        section: "var(--section-gap)",
        card: "var(--card-padding)",
        field: "var(--field-gap)",
        control: "var(--control-height)",
        row: "var(--table-row-height)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
