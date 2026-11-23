import type { Config } from 'tailwindcss'

const c = (v: string) => `hsl(var(--${v}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        border: c('border'),
        input: c('input'),
        ring: c('ring'),
        background: c('background'),
        foreground: c('foreground'),
        primary: { DEFAULT: c('primary'), foreground: c('primary-foreground') },
        secondary: { DEFAULT: c('secondary'), foreground: c('secondary-foreground') },
        muted: { DEFAULT: c('muted'), foreground: c('muted-foreground') },
        accent: { DEFAULT: c('accent'), foreground: c('accent-foreground') },
        destructive: { DEFAULT: c('destructive'), foreground: c('destructive-foreground') },
        card: { DEFAULT: c('card'), foreground: c('card-foreground') },
        popover: { DEFAULT: c('popover'), foreground: c('popover-foreground') },
        success: c('success'),
        warning: c('warning')
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      fontFamily: {
        sans: ['Inter', '"Kantumruy Pro"', '"Segoe UI"', '"Khmer UI"', '"Leelawadee UI"', 'system-ui', 'sans-serif'],
        hanuman: ['Hanuman', '"Kantumruy Pro"', '"Khmer UI"', 'serif'],
        mono: ['"JetBrains Mono"', '"Kantumruy Pro"', '"Cascadia Mono"', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
} satisfies Config
