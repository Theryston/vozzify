'use client';

import {
  ExternalLinkIcon,
  SettingsIcon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CalibrationDialog } from '@/features/practice/components/calibration-dialog';
import { ScoringSettings } from '@/features/practice/components/scoring-settings';
import { SingingAidsSettings } from '@/features/practice/components/singing-aids-settings';

import type { PlaybackController } from '../playback/playback-controller';
import { PLAYBACK_RATES } from '../player/player-port';
import { usePlaybackState } from '../stores/playback-store';
import { youtubeWatchUrl } from '../youtube-links';
import { LoopSetting } from './loop-setting';

/**
 * The dock's Settings menu: speed, mute and "Open on YouTube".
 * The dock loads it with a client-only dynamic import, so Base UI's menu stays
 * out of the page's first-load JS.
 */
export function DockSettings({
  controller,
  videoId,
}: {
  controller: PlaybackController | null;
  videoId: string | null;
}) {
  const t = useTranslations('tracks.practice.dock');
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const rate = usePlaybackState((state) => state.rate);
  const muted = usePlaybackState((state) => state.muted);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('settings')}
              className="md:w-auto md:gap-2 md:px-3"
            />
          }
        >
          <SettingsIcon aria-hidden="true" />
          <span className="hidden md:inline">{t('settings')}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          sideOffset={12}
          className="w-auto"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('speed')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(rate)}
              onValueChange={(value) => controller?.setRate(Number(value))}
            >
              {PLAYBACK_RATES.map((option) => (
                <DropdownMenuRadioItem key={option} value={String(option)}>
                  <span className="font-mono tabular-nums">
                    {t('speedOption', { rate: option })}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <LoopSetting />
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={muted}
            onCheckedChange={() => controller?.toggleMuted()}
          >
            {muted ? (
              <VolumeXIcon aria-hidden="true" />
            ) : (
              <Volume2Icon aria-hidden="true" />
            )}
            {t('mute')}
          </DropdownMenuCheckboxItem>
          <ScoringSettings />
          <SingingAidsSettings
            onCalibrate={() => {
              controller?.pause();
              setCalibrationOpen(true);
            }}
          />
          {videoId ? (
            <DropdownMenuItem
              render={
                <a
                  href={youtubeWatchUrl(videoId)}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLinkIcon aria-hidden="true" />
              {t('openOnYouTube')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <CalibrationDialog
        open={calibrationOpen}
        onOpenChange={setCalibrationOpen}
        pause={() => controller?.pause()}
      />
    </>
  );
}
