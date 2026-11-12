type ColorScheme = 'light' | 'dark';
type AppearanceListener = (preferences: { colorScheme: ColorScheme }) => void;

const listeners = new Set<AppearanceListener>();
let colorScheme: ColorScheme = 'light';

export function addChangeListener(listener: AppearanceListener) {
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}

export function getColorScheme() {
  return colorScheme;
}

export const setColorScheme = jest.fn();

export function emitAppearanceChange(nextColorScheme: ColorScheme) {
  colorScheme = nextColorScheme;
  for (const listener of listeners) {
    listener({ colorScheme });
  }
}
