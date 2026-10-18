import { Chip, createTheme, SegmentedControl, type MantineColorsTuple } from '@mantine/core';

/** Browser/OS chrome colour (PWA manifest `theme_color`, `<meta name="theme-color">`). */
export const THEME_COLOR = '#2b3a4a';

const neutral: MantineColorsTuple = [
  '#f3f5f7', '#e4e8ec', '#cbd2d9', '#aab4be', '#8793a0',
  '#6b7885', '#546270', '#41505e', '#2b3a4a', '#1d2935',
];

const danger: MantineColorsTuple = [
  '#fff0f0', '#ffdede', '#ffbdbd', '#ff9696', '#f77070',
  '#ea5252', '#d93a3a', '#bf2c2c', '#a02424', '#7f1d1d',
];

const warning: MantineColorsTuple = [
  '#fff8e6', '#ffeebd', '#ffe08a', '#ffd056', '#f7be2e',
  '#e6a812', '#c98d0a', '#a67008', '#835608', '#5f3e06',
];

export const theme = createTheme({
  primaryColor: 'neutral',
  primaryShade: 8,
  colors: { neutral, danger, warning },
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  headings: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  defaultRadius: 'md',
  components: {
    // Touch targets must be at least 44 px tall (global constraint).
    Chip: Chip.extend({
      styles: { label: { minBlockSize: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } },
    }),
    SegmentedControl: SegmentedControl.extend({
      styles: { label: { minBlockSize: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
    }),
  },
});
