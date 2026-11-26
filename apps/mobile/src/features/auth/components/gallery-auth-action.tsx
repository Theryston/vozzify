import { Link } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Button } from '../../../components/ui/button';
import { authRouteParams } from '../../../lib/auth/auth-continuation';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';

export function GalleryAuthAction() {
  const t = useTranslations('components');
  const { user } = useMobileAuth();
  if (user) return null;

  return (
    <Link
      href={{
        pathname: '/sign-in',
        params: authRouteParams({
          destination: '/components',
          action: 'open-overlay',
        }),
      }}
      asChild
    >
      <Button
        variant="outline"
        accessibilityRole="link"
        testID="gallery-sign-in-overlay"
      >
        {t('signInOverlay')}
      </Button>
    </Link>
  );
}
