import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Screen } from '../src/components/screen';
import { Text } from '../src/components/text';
import { Button } from '../src/components/ui/button';
import { Input } from '../src/components/ui/input';
import { Overlay } from '../src/components/ui/overlay';

export default function ComponentsScreen() {
  const translate = useTranslations('components');
  const [input, setInput] = useState('');
  const [overlayOpen, setOverlayOpen] = useState(false);

  return (
    <Screen>
      <Text variant="heading">{translate('title')}</Text>
      <Text>{translate('description')}</Text>
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
