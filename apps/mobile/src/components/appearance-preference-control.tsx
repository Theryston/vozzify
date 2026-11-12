import { Pressable, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { appearancePreferences } from '../lib/appearance/appearance-preference';
import { useMobileAppearance } from '../lib/appearance/mobile-appearance-provider';
import { Text } from './text';

export function AppearancePreferenceControl() {
  const translate = useTranslations('appearance');
  const { preference, setPreference } = useMobileAppearance();

  return (
    <View accessibilityRole="radiogroup" className="gap-2">
      {appearancePreferences.map((option) => (
        <Pressable
          accessibilityLabel={translate(option)}
          accessibilityRole="radio"
          accessibilityState={{ checked: preference === option }}
          className="min-h-10 flex-row items-center rounded-full border border-border bg-background px-4 py-2"
          key={option}
          onPress={() => {
            void setPreference(option).catch(() => undefined);
          }}
        >
          <Text>{translate(option)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
