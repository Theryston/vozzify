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
      {appearancePreferences.map((option) => {
        const isSelected = preference === option;

        return (
          <Pressable
            accessibilityLabel={translate(option)}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            className={`min-h-10 flex-row items-center rounded-full border px-4 py-2 ${isSelected ? 'border-primary bg-primary' : 'border-border bg-background'}`}
            key={option}
            onPress={() => {
              void setPreference(option).catch(() => undefined);
            }}
          >
            <Text
              className={
                isSelected ? 'text-primary-foreground' : 'text-foreground'
              }
            >
              {translate(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
