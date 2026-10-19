import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  createTheme,
  Input,
  Menu,
  Modal,
  Paper,
  SegmentedControl,
  Tabs,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from '@mantine/core';

/**
 * Style B, "Warm UOCA brand". The only place in the client that names colours: everything else uses Mantine colour
 * names (`uoca`, `success`, ...) or the `--uoca-*` CSS variables defined below.
 */
export const BRAND = {
  gold: '#c8b37d',
  brown: '#584921',
  text: '#3b2f1e',
  cream: '#faf6ee',
  border: '#eadfc5',
  borderStrong: '#d9caa3',
  muted: '#8a7a5c',
  onBrown: '#f5ead0',
  white: '#ffffff',
} as const;

/** Browser/OS chrome colour (PWA manifest `theme_color`, `<meta name="theme-color">`). */
export const THEME_COLOR = BRAND.brown;
/** PWA splash background. */
export const BACKGROUND_COLOR = BRAND.cream;

/** Gold (4) to deep brown (8) and text brown (9). Primary buttons use shade 8. */
const uoca: MantineColorsTuple = [
  '#faf6ee', '#f3ead6', '#eadfc5', '#dccb9f', '#c8b37d',
  '#ad9659', '#8f7a3f', '#73622f', '#584921', '#3b2f1e',
];

/** Warm sand greys: neutral badges, quiet surfaces. */
const neutral: MantineColorsTuple = [
  '#f6f2ea', '#ece6d8', '#ddd4c1', '#c6bba5', '#a99d84',
  '#8a7a5c', '#6f6248', '#574c38', '#3b2f1e', '#2a2116',
];

const success: MantineColorsTuple = [
  '#e8f2e3', '#d3e6ca', '#b3d3a5', '#8fbd7d', '#6fa55b',
  '#578f44', '#477c37', '#3d6b2e', '#2f5523', '#213d18',
];

const amber: MantineColorsTuple = [
  '#f6ecd6', '#efdfb8', '#e5cc8c', '#d8b660', '#c99f3d',
  '#b48a2b', '#9e7a23', '#8a6a1e', '#6e5418', '#523e12',
];

const slate: MantineColorsTuple = [
  '#e8edf2', '#d4dde6', '#b6c4d2', '#96aabd', '#7891a8',
  '#617b94', '#526a81', '#45596d', '#38485a', '#2a3644',
];

const danger: MantineColorsTuple = [
  '#fbe9e7', '#f6d1cc', '#eeaaa2', '#e47f74', '#d65a4d',
  '#c64234', '#b0342a', '#962a22', '#7a211b', '#5c1813',
];

const warning: MantineColorsTuple = amber;

const grey: MantineColorsTuple = [
  '#f1f0ee', '#e4e2de', '#cfccc6', '#b5b1a9', '#9a958c',
  '#807b72', '#6a655d', '#55514a', '#403d38', '#2c2a26',
];

/** Every status a badge can show: the session statuses plus the board's "waiting" (scheduled today, not started). */
export type StatusTone = 'scheduled' | 'waiting' | 'active' | 'completed' | 'postponed' | 'missed' | 'did_not_come' | 'cancelled';

/** Badge look per session status: each one distinct and readable on cream. */
export const STATUS_TONES: Record<StatusTone, { bg: string; fg: string; strike?: boolean }> = {
  scheduled: { bg: 'var(--mantine-color-neutral-1)', fg: 'var(--mantine-color-neutral-6)' },
  waiting: { bg: 'var(--mantine-color-amber-0)', fg: 'var(--mantine-color-amber-7)' },
  active: { bg: 'var(--mantine-color-success-0)', fg: 'var(--mantine-color-success-7)' },
  completed: { bg: 'var(--mantine-color-uoca-4)', fg: 'var(--mantine-color-uoca-9)' },
  postponed: { bg: 'var(--mantine-color-slate-0)', fg: 'var(--mantine-color-slate-7)' },
  did_not_come: { bg: 'var(--mantine-color-danger-0)', fg: 'var(--mantine-color-danger-6)' },
  missed: { bg: 'var(--mantine-color-danger-8)', fg: 'var(--mantine-color-white)' },
  cancelled: { bg: 'var(--mantine-color-grey-1)', fg: 'var(--mantine-color-grey-6)', strike: true },
};

/** Badge look per patient status: in care (green), moving to another centre (amber), discharged (grey). */
export const PATIENT_STATUS_TONES: Record<'active' | 'transferring' | 'discharged', { bg: string; fg: string }> = {
  active: STATUS_TONES.active,
  transferring: STATUS_TONES.waiting,
  discharged: { bg: 'var(--mantine-color-grey-1)', fg: 'var(--mantine-color-grey-7)' },
};

/**
 * Mantine's `light` variant is the shade-8 colour at 10 % opacity, which turns grey on the warm palette: use the
 * scale's own pale shades instead.
 */
const lightVariants = Object.fromEntries(
  (['uoca', 'neutral', 'success', 'amber', 'slate', 'danger', 'warning', 'grey'] as const).flatMap((c) => [
    [`--mantine-color-${c}-light`, `var(--mantine-color-${c}-${c === 'uoca' ? 1 : 0})`],
    [`--mantine-color-${c}-light-hover`, `var(--mantine-color-${c}-${c === 'uoca' ? 2 : 1})`],
    [`--mantine-color-${c}-light-color`, `var(--mantine-color-${c}-${c === 'uoca' ? 8 : 7})`],
  ]),
);

/** Brand tokens as CSS variables, and Mantine's body/text/dimmed/border colours set to the brand. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--uoca-gold': BRAND.gold,
    '--uoca-brown': BRAND.brown,
    '--uoca-text': BRAND.text,
    '--uoca-cream': BRAND.cream,
    '--uoca-border': BRAND.border,
    '--uoca-border-strong': BRAND.borderStrong,
    '--uoca-muted': BRAND.muted,
    '--uoca-on-brown': BRAND.onBrown,
    '--uoca-surface': BRAND.white,
  },
  light: {
    '--mantine-color-body': BRAND.cream,
    '--mantine-color-text': BRAND.text,
    '--mantine-color-dimmed': BRAND.muted,
    '--mantine-color-default-border': BRAND.borderStrong,
    '--mantine-color-placeholder': BRAND.muted,
    ...lightVariants,
  },
  dark: {},
});

const FONT = '"IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const theme = createTheme({
  primaryColor: 'uoca',
  primaryShade: 8,
  colors: { uoca, neutral, success, amber, slate, danger, warning, grey },
  white: BRAND.white,
  black: BRAND.text,
  fontFamily: FONT,
  headings: {
    fontFamily: FONT,
    fontWeight: '700',
    sizes: {
      h1: { fontSize: '1.75rem', lineHeight: '1.3' },
      h2: { fontSize: '1.5rem', lineHeight: '1.3' },
      h3: { fontSize: '1.25rem', lineHeight: '1.35' },
      h4: { fontSize: '1.0625rem', lineHeight: '1.4' },
    },
  },
  defaultRadius: 'md',
  radius: { xs: '4px', sm: '8px', md: '10px', lg: '16px', xl: '24px' },
  shadows: {
    xs: '0 1px 2px rgba(88, 73, 33, 0.05)',
    sm: '0 1px 3px rgba(88, 73, 33, 0.07), 0 1px 2px rgba(88, 73, 33, 0.04)',
    md: '0 4px 12px rgba(88, 73, 33, 0.08)',
    lg: '0 8px 24px rgba(88, 73, 33, 0.10)',
    xl: '0 16px 40px rgba(88, 73, 33, 0.12)',
  },
  components: {
    Card: Card.extend({
      defaultProps: { radius: 'lg', shadow: 'sm', withBorder: true, padding: 'md' },
      styles: { root: { borderColor: 'var(--uoca-border)', backgroundColor: 'var(--uoca-surface)' } },
    }),
    Paper: Paper.extend({
      styles: { root: { borderColor: 'var(--uoca-border)' } },
    }),
    Button: Button.extend({
      defaultProps: { radius: 'md' },
      styles: { root: { fontWeight: 600 } },
    }),
    ActionIcon: ActionIcon.extend({ defaultProps: { radius: 'md' } }),
    Badge: Badge.extend({
      defaultProps: { radius: 'sm', size: 'md' },
      styles: { root: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 } },
    }),
    Input: Input.extend({
      styles: { input: { backgroundColor: 'var(--uoca-surface)', borderColor: 'var(--uoca-border-strong)' } },
    }),
    Alert: Alert.extend({ defaultProps: { radius: 'lg' } }),
    Modal: Modal.extend({ defaultProps: { radius: 'lg' } }),
    Menu: Menu.extend({ defaultProps: { radius: 'md', shadow: 'md' } }),
    Tabs: Tabs.extend({ defaultProps: { color: 'uoca' } }),
    // Touch targets must be at least 44 px tall (global constraint).
    Chip: Chip.extend({
      styles: { label: { minBlockSize: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } },
    }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { radius: 'xl' },
      styles: {
        root: { backgroundColor: 'var(--mantine-color-uoca-1)' },
        // unselected options must stay readable on the sand track: brown text, not Mantine's grey
        label: { minBlockSize: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, color: 'var(--mantine-color-uoca-8)' },
        indicator: { boxShadow: 'var(--mantine-shadow-sm)', border: '1px solid var(--uoca-border)' },
      },
    }),
  },
});
