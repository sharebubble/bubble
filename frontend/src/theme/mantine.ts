import { createTheme, type MantineColorsTuple } from '@mantine/core';

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
  white: '#fbfaf9',
  black: '#171411',
  defaultRadius: 'md',
  colors: {
    green: bubbleGreen,
  },
  primaryColor: 'green',
});
