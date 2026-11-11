import type { TextInputProps } from 'react-native';
import { TextInput } from 'react-native';
import { useCustomFontsAvailable } from '../../lib/design/font-availability';
import { nativeFontFamilies } from '../../lib/design/native-fonts';

export function Input(props: TextInputProps) {
  const customFontsAvailable = useCustomFontsAvailable();

  return (
    <TextInput
      className={`min-h-10 rounded-full border border-input bg-muted px-4 py-2 ${customFontsAvailable ? 'font-sans' : ''} text-base text-foreground`}
      placeholderTextColorClassName="accent-muted-foreground"
      style={
        customFontsAvailable
          ? { fontFamily: nativeFontFamilies.regular }
          : undefined
      }
      {...props}
    />
  );
}
