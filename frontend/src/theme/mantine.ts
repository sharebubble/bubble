import { Badge, createTheme, em, type MantineColorsTuple } from '@mantine/core';

const bubbleGreen: MantineColorsTuple = [
  '#edf6ed',
  '#d9ebd9',
  '#b2d6b2',
  '#8bc18b',
  '#64ab64',
  '#438c43',
  '#387538',
  '#2d5e2d',
  '#224822',
  '#173117',
];

export const mantineTheme = createTheme({
  // use the same breakpoints as in Tailwind
  breakpoints: {
    xs: em(480),
    sm: em(640),
    md: em(768),
    lg: em(1024),
    xl: em(1280),
  },
  white: '#fbfaf9',
  black: '#171411',
  defaultRadius: 'md',
  colors: {
    green: bubbleGreen,
  },
  primaryColor: 'green',
  components: {
    // Keep sentence-case badges as in the pre-Mantine design
    Badge: Badge.extend({
      styles: { label: { textTransform: 'none' } },
    }),
  },
});
