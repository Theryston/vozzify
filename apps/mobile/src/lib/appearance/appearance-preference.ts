export const appearancePreferences = ['system', 'light', 'dark'] as const;

export type AppearancePreference = (typeof appearancePreferences)[number];

export function parseAppearancePreference(
  value: string | null,
): AppearancePreference {
  return (
    appearancePreferences.find((preference) => preference === value) ?? 'system'
  );
}
