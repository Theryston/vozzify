import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { AppearancePreferenceControl } from '../src/components/appearance-preference-control';
import { Screen } from '../src/components/screen';
import { Text } from '../src/components/text';
import { Button } from '../src/components/ui/button';
import { Input } from '../src/components/ui/input';
import { Overlay } from '../src/components/ui/overlay';
import { useMobileLocale } from '../src/lib/i18n/mobile-locale-provider';

export default function ComponentsScreen() {
  const translate = useTranslations('components');
  const preferenceTranslate = useTranslations('preferences');
  const { locale, setLocale } = useMobileLocale();
  const [input, setInput] = useState('');
  const [overlayOpen, setOverlayOpen] = useState(false);

  return (
    <Screen>
      <Text variant="heading">{translate('title')}</Text>
      <Text>{translate('description')}</Text>
      <Text>{preferenceTranslate('language')}</Text>
      <Button
        accessibilityLabel={preferenceTranslate('english')}
        accessibilityRole="radio"
        accessibilityState={{ checked: locale === 'en' }}
        onPress={() => setLocale('en')}
        testID="language-en"
        variant={locale === 'en' ? 'primary' : 'outline'}
      >
        {preferenceTranslate('english')}
      </Button>
      <Button
        accessibilityLabel={preferenceTranslate('brazilianPortuguese')}
        accessibilityRole="radio"
        accessibilityState={{ checked: locale === 'pt-BR' }}
        onPress={() => setLocale('pt-BR')}
        testID="language-pt-BR"
        variant={locale === 'pt-BR' ? 'primary' : 'outline'}
      >
        {preferenceTranslate('brazilianPortuguese')}
      </Button>
      <Text>{translate('appearanceTitle')}</Text>
      <AppearancePreferenceControl />
      <Button accessibilityLabel={translate('buttonLabel')}>
        {translate('button')}
      </Button>
      <Input
        accessibilityLabel={translate('inputLabel')}
        onChangeText={setInput}
        placeholder={translate('inputPlaceholder')}
        testID="gallery-input"
        value={input}
      />
      <Button
        accessibilityLabel={translate('openOverlay')}
        onPress={() => setOverlayOpen(true)}
        variant="secondary"
      >
        {translate('openOverlay')}
      </Button>
      <Overlay
        onOpenChange={setOverlayOpen}
        open={overlayOpen}
        dismissLabel={translate('dismissOverlay')}
        title={translate('overlayTitle')}
      >
        {translate('overlayDescription')}
      </Overlay>
      <Link href="/" asChild>
        <Button accessibilityRole="link" testID="return-home" variant="outline">
          {translate('returnHome')}
        </Button>
      </Link>
    </Screen>
  );
}
