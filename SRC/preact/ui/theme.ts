/**
 * MUI dark theme — maps the application's CSS custom properties into MUI theme tokens.
 *
 * The app uses a dark palette defined in style.css (--bg, --bg2, --bg3, --accent, etc.).
 * This theme ensures MUI components use the same palette instead of MUI's default dark theme,
 * which would produce a visual mismatch.
 *
 * Also sets compact typography and component sizing to match the app's intended dense layout.
 *
 * Design tokens (from style.css :root):
 *   --bg:      #0d1117   background.paper/tooltip
 *   --bg2:     #161b22   background.default
 *   --bg3:     #21262d   input/select background
 *   --border:  #30363d   divider
 *   --text:    #e6edf3   text.primary
 *   --muted:   #8b949e   text.secondary
 *   --accent:  #58a6ff   primary.main
 *   --accent2: #388bfd   primary.dark
 *   --green:   #3fb950   success.main
 *   --red:     #f85149   error.main
 *   --yellow:  #d29922   warning.main
 */

import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#58a6ff',
      dark: '#388bfd',
      contrastText: '#e6edf3',
    },
    error: {
      main: '#f85149',
    },
    success: {
      main: '#3fb950',
    },
    warning: {
      main: '#d29922',
    },
    background: {
      default: '#0d1117',
      paper: '#161b22',
    },
    text: {
      primary: '#e6edf3',
      secondary: '#8b949e',
    },
    divider: '#30363d',
    action: {
      hover: 'rgba(88,166,255,0.06)',
      selected: 'rgba(88,166,255,0.12)',
      focus: 'rgba(88,166,255,0.12)',
      disabled: 'rgba(139,148,158,0.35)',
      disabledBackground: 'rgba(33,38,45,0.5)',
    },
  },

  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'system-ui',
      'sans-serif',
    ].join(','),
    // Smaller base than MUI's default 14px — app is data-dense
    fontSize: 13,
    body1: { fontSize: '0.82rem' },
    body2: { fontSize: '0.78rem' },
    caption: { fontSize: '0.72rem' },
    overline: { fontSize: '0.68rem', letterSpacing: '0.07em' },
    button: { fontSize: '0.78rem', textTransform: 'none' },
  },

  shape: {
    borderRadius: 6,
  },

  components: {
    // ── CSS baseline — keep app layout on body ──────────────────────
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
      },
    },

    // ── Card — match CSS .card { background: var(--bg2) } ──
    MuiCard: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#161b22',
        },
      },
    },

    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: '12px 14px',
          '&:last-child': {
            paddingBottom: '12px 14px',
          },
        },
      },
    },

    // ── Input / Select / TextField ──────────────────────────────────
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: '#21262d',
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#58a6ff',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#58a6ff',
            borderWidth: 1,
          },
          '&.Mui-disabled': {
            opacity: 0.5,
          },
        },
        notchedOutline: {
          borderColor: '#30363d',
        },
        input: {
          padding: '4px 8px',
          fontSize: '0.78rem',
          '&::placeholder': {
            color: '#8b949e',
            opacity: 1,
          },
        },
      },
    },

    MuiSelect: {
      styleOverrides: {
        select: {
          padding: '4px 30px 4px 8px',
          fontSize: '0.78rem',
          minHeight: 'unset',
          '&.Mui-disabled': {
            opacity: 0.5,
          },
        },
        icon: {
          color: '#8b949e',
          fontSize: '1.1rem',
        },
      },
    },

    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: '0.78rem',
          color: '#8b949e',
        },
      },
    },

    // ── Menu / Dropdown ────────────────────────────────────────────
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: '#21262d',
          border: '1px solid #30363d',
          backgroundImage: 'none',
        },
        list: {
          padding: '4px 0',
        },
      },
    },

    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: '0.78rem',
          padding: '4px 12px',
          minHeight: 'unset',
          color: '#e6edf3',
          '&:hover': {
            backgroundColor: 'rgba(88,166,255,0.08)',
          },
          '&.Mui-selected': {
            backgroundColor: 'rgba(88,166,255,0.12)',
            '&:hover': {
              backgroundColor: 'rgba(88,166,255,0.16)',
            },
          },
        },
      },
    },

    // ── Button ──────────────────────────────────────────────────────
    MuiButton: {
      defaultProps: {
        disableRipple: true,
      },
      styleOverrides: {
        root: {
          fontSize: '0.78rem',
          minHeight: 'unset',
          padding: '4px 12px',
          lineHeight: 1.4,
        },
        text: {
          color: '#8b949e',
          padding: '4px 8px',
          '&:hover': {
            backgroundColor: 'rgba(255,255,255,0.06)',
            color: '#e6edf3',
          },
        },
        contained: {
          backgroundColor: '#21262d',
          color: '#e6edf3',
          border: '1px solid #30363d',
          '&:hover': {
            backgroundColor: '#30363d',
            borderColor: '#8b949e',
          },
          '&.Mui-disabled': {
            backgroundColor: 'rgba(33,38,45,0.5)',
            color: 'rgba(139,148,158,0.35)',
          },
        },
        containedPrimary: {
          backgroundColor: '#58a6ff',
          color: '#0d1117',
          border: '1px solid #58a6ff',
          '&:hover': {
            backgroundColor: '#79b8ff',
            borderColor: '#79b8ff',
          },
          '&.Mui-disabled': {
            backgroundColor: 'rgba(88,166,255,0.3)',
            color: 'rgba(13,17,23,0.5)',
          },
        },
        containedError: {
          backgroundColor: 'transparent',
          color: '#f85149',
          border: '1px solid #f85149',
          '&:hover': {
            backgroundColor: 'rgba(248,81,73,0.12)',
            borderColor: '#f85149',
          },
        },
        outlined: {
          borderColor: '#30363d',
          color: '#e6edf3',
          padding: '4px 12px',
          '&:hover': {
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderColor: '#8b949e',
          },
        },
        sizeSmall: {
          fontSize: '0.72rem',
          padding: '2px 8px',
        },
      },
    },

    // ── ToggleButton ──────────────────────────────────────────────
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          backgroundColor: '#21262d',
          border: '1px solid #30363d',
          borderRadius: 6,
          padding: 2,
        },
      },
    },

    MuiToggleButton: {
      styleOverrides: {
        root: {
          fontSize: '0.76rem',
          padding: '4px 12px',
          textTransform: 'none',
          color: '#8b949e',
          border: 'none',
          borderRadius: 4,
          backgroundColor: 'transparent',
          '&:hover': {
            color: '#e6edf3',
            backgroundColor: 'rgba(255,255,255,0.04)',
          },
          '&.Mui-selected': {
            color: '#e6edf3',
            backgroundColor: '#0d1117',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
            '&:hover': {
              backgroundColor: '#0d1117',
            },
          },
          '&.Mui-disabled': {
            opacity: 0.4,
          },
        },
      },
    },

    // ── Tabs ──────────────────────────────────────────────────────
    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 'auto',
          borderBottom: '1px solid #30363d',
        },
        indicator: {
          backgroundColor: '#58a6ff',
        },
      },
    },

    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 'auto',
          padding: '8px 16px',
          fontSize: '0.82rem',
          textTransform: 'none',
          color: '#8b949e',
          '&.Mui-selected': {
            color: '#e6edf3',
            fontWeight: 600,
          },
        },
      },
    },

    // ── Checkbox / Radio ──────────────────────────────────────────
    MuiCheckbox: {
      styleOverrides: {
        root: {
          padding: 4,
          color: '#8b949e',
          '&.Mui-checked': {
            color: '#58a6ff',
          },
          '&.Mui-disabled': {
            opacity: 0.4,
          },
        },
      },
    },

    MuiRadio: {
      styleOverrides: {
        root: {
          padding: 4,
          color: '#8b949e',
          '&.Mui-checked': {
            color: '#58a6ff',
          },
        },
      },
    },

    MuiFormControlLabel: {
      styleOverrides: {
        root: {
          marginLeft: 0,
          marginRight: 0,
        },
        label: {
          fontSize: '0.76rem',
          color: '#e6edf3',
        },
      },
    },

    // ── Dialog / Modal ────────────────────────────────────────────
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: '#161b22',
          backgroundImage: 'none',
          border: '1px solid #30363d',
          borderRadius: 8,
        },
      },
    },

    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontSize: '1rem',
          fontWeight: 600,
          padding: '16px 20px 8px',
          color: '#e6edf3',
        },
      },
    },

    MuiDialogContent: {
      styleOverrides: {
        root: {
          padding: '8px 20px 16px',
          color: '#e6edf3',
          fontSize: '0.82rem',
        },
      },
    },

    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: '8px 20px 16px',
          gap: 8,
        },
      },
    },

    // ── Chip (MUI Chip used by our Chip component) ───────────────
    MuiChip: {
      styleOverrides: {
        root: {
          fontSize: '0.72rem',
          height: 'auto',
          borderRadius: 10,
          backgroundColor: '#21262d',
          border: '1px solid #30363d',
          color: '#e6edf3',
          '&:hover': {
            backgroundColor: 'rgba(255,255,255,0.06)',
          },
        },
        label: {
          padding: '3px 9px',
          fontSize: '0.72rem',
        },
      },
    },

    // ── Tooltip ──────────────────────────────────────────────────
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#21262d',
          color: '#e6edf3',
          border: '1px solid #30363d',
          fontSize: '0.72rem',
          padding: '6px 10px',
          borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        },
        arrow: {
          color: '#21262d',
          '&::before': {
            border: '1px solid #30363d',
          },
        },
      },
    },

    // ── Slider ───────────────────────────────────────────────────
    MuiSlider: {
      styleOverrides: {
        root: {
          color: '#58a6ff',
        },
      },
    },

    // ── Table ────────────────────────────────────────────────────
    MuiTable: {
      styleOverrides: {
        root: {
          backgroundColor: '#161b22',
        },
      },
    },

    // ── Switch ───────────────────────────────────────────────────
    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          color: '#8b949e',
        },
        colorPrimary: {
          '&.Mui-checked': {
            color: '#58a6ff',
          },
        },
        track: {
          backgroundColor: '#30363d',
          opacity: 1,
        },
      },
    },
  },
});

export default theme;
