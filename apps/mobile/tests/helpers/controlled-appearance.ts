type ColorScheme = 'light' | 'dark';
type AppearanceListener = (preferences: { colorScheme: ColorScheme }) => void;

export const controlledAppearance = (() => {
  const listeners = new Set<AppearanceListener>();
  let colorScheme: ColorScheme = 'light';

  return {
    addChangeListener(listener: AppearanceListener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    getColorScheme() {
      return colorScheme;
    },
    setColorScheme: jest.fn(),
    emitAppearanceChange(nextColorScheme: ColorScheme) {
      colorScheme = nextColorScheme;
      for (const listener of listeners) {
        listener({ colorScheme });
      }
    },
  };
})();
