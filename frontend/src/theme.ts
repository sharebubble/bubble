import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Sage green palette (primary brand color) — hsl(120 25% 35%) ≈ #4a7a42
const brandGreen: MantineColorsTuple = [
  '#eef6ec', // 0
  '#d3e9ce', // 1
  '#aed4a7', // 2
  '#85bc7c', // 3
  '#62a558', // 4
  '#4e9448', // 5 — dark-mode primary
  '#3f7a3b', // 6 — light-mode primary  (hsl 120 25% 35% ≈ #447839 → 3f7a3b close)
  '#305c2d', // 7
  '#213e1f', // 8
  '#122011', // 9
];

export const mantineTheme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 5 },

  colors: {
    brand: brandGreen,
  },

  fontFamily: 'inherit',
  fontFamilyMonospace: 'inherit',

  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
  },

  components: {
    Button: {
      defaultProps: {
        radius: 'md',
      },
    },
    Badge: {
      defaultProps: {
        radius: 'md',
      },
    },
    Card: {
      defaultProps: {
        radius: 'md',
      },
    },
    Modal: {
      defaultProps: {
        radius: 'lg',
        centered: true,
      },
    },
    Drawer: {
      defaultProps: {
        radius: 'md',
      },
    },
    TextInput: {
      defaultProps: {
        radius: 'md',
      },
    },
    Textarea: {
      defaultProps: {
        radius: 'md',
      },
    },
    Select: {
      defaultProps: {
        radius: 'md',
      },
    },
    Popover: {
      defaultProps: {
        radius: 'md',
      },
    },
    Menu: {
      defaultProps: {
        radius: 'md',
      },
    },
    Notification: {
      defaultProps: {
        radius: 'md',
      },
    },
  },
});
