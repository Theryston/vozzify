import type { TextInputProps } from 'react-native';
import { TextInput } from 'react-native';
import { nativeFontFamilies } from '../../lib/design/native-fonts';

export function Input(props: TextInputProps) {
  return (
    <TextInput
      className="min-h-10 rounded-full border border-input bg-muted px-4 py-2 font-sans text-base text-foreground"
      placeholderTextColorClassName="accent-muted-foreground"
      accessibilityRole="text"
      style={{ fontFamily: nativeFontFamilies.regular }}
      {...props}
    />
  );
}
