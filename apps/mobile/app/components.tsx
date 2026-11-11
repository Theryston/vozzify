import { Link } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { useTranslations } from 'use-intl';
import { Screen } from '../src/components/screen';
import { Text } from '../src/components/text';

const styles = StyleSheet.create({ button: { paddingVertical: 12 } });

export default function ComponentsScreen() {
  const translate = useTranslations('components');

  return (
    <Screen>
      <Text variant="heading">{translate('title')}</Text>
      <Text>{translate('description')}</Text>
      <Link href="/" asChild>
        <Pressable
          accessibilityRole="link"
          style={styles.button}
          testID="return-home"
        >
          <Text>{translate('returnHome')}</Text>
        </Pressable>
      </Link>
    </Screen>
  );
}
