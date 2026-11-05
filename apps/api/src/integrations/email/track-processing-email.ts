import {
  pitchName,
  type TrackArtistCreditEntry,
  type TrackVocalRange,
} from '@vozzify/contracts';
import type { EmailMessage } from './email.job.js';
import { escapeHtml } from './email-html.js';
import {
  type EmailWebOrigin,
  emailButton,
  emailParagraph,
  renderEmailFromCopy,
} from './email-layout.js';
import type { EmailLocale } from './email-locale.js';

type TrackEmailCopy = {
  subject: string;
  overline: string;
  title: string;
  preheader: string;
  reason: string;
  intro: string;
  action: string;
  link: string;
};

// User-facing copy lives only here, one entry per locale.
const COMPLETED = {
  en: {
    subject: 'Your notes are ready on vozzify',
    overline: 'Notes ready',
    title: 'Time to practice',
    preheader: 'The vocal notes of your track are ready to practice.',
    reason: 'You got this email because you contributed to a track on Vozzify.',
    intro:
      'The vocal notes and timed lyrics of a track you contributed to are ready.',
    action: 'Open the track to start practicing.',
    link: 'Open the track',
  },
  'pt-BR': {
    subject: 'As notas da sua música estão prontas no vozzify',
    overline: 'Notas prontas',
    title: 'Hora de praticar',
    preheader: 'As notas vocais da sua música estão prontas para praticar.',
    reason:
      'Você recebeu este email porque contribuiu com uma música no Vozzify.',
    intro:
      'As notas vocais e a letra sincronizada de uma música em que você participou estão prontas.',
    action: 'Abra a música para começar a praticar.',
    link: 'Abrir a música',
  },
} as const satisfies Record<EmailLocale, TrackEmailCopy>;

const FAILED = {
  en: {
    subject: 'We could not finish the notes of a track',
    overline: 'Processing failed',
    title: 'Not ready yet',
    preheader: 'We could not finish the notes of your track.',
    reason: 'You got this email because you contributed to a track on Vozzify.',
    intro:
      'The processing of a track you contributed to failed before its notes were ready.',
    action:
      'Open the track to see why. If the failure can be retried, you can try again there.',
    link: 'Open the track',
  },
  'pt-BR': {
    subject: 'Não conseguimos terminar as notas de uma música',
    overline: 'Processamento falhou',
    title: 'Ainda não ficou pronto',
    preheader: 'Não conseguimos terminar as notas da sua música.',
    reason:
      'Você recebeu este email porque contribuiu com uma música no Vozzify.',
    intro:
      'O processamento de uma música em que você participou falhou antes de as notas ficarem prontas.',
    action:
      'Abra a música para ver o motivo. Se for possível tentar de novo, você pode fazer isso por lá.',
    link: 'Abrir a música',
  },
} as const satisfies Record<EmailLocale, TrackEmailCopy>;

/** The Track fields a track email shows, as the Track row stores them. */
export type TrackEmailTrack = {
  title: string;
  artistCredit: readonly TrackArtistCreditEntry[];
  /** The cover in our own storage; null when the Track has none. */
  coverUrl: string | null;
  /** Null for a Track without notes. */
  vocalRange: TrackVocalRange | null;
};

/** One Contributor's email: where it goes, in which language, the Track's page and the Track. */
export type TrackEmailInput = {
  to: string;
  locale: EmailLocale;
  trackUrl: string;
  track: TrackEmailTrack;
};

/** The artist credit as the Recording prints it ("Queen feat. David Bowie"). */
const creditText = (credit: TrackEmailTrack['artistCredit']): string =>
  credit.map((entry) => `${entry.name}${entry.joinPhrase}`).join('');

/** The two note names of the vocal range, `E2–A4`; undefined without notes. */
const rangeText = (vocalRange: TrackVocalRange | null): string | undefined =>
  vocalRange === null
    ? undefined
    : `${pitchName(vocalRange.lowest)}–${pitchName(vocalRange.highest)}`;

/** The artist and the range on one line, for the plain-text body. */
const artistLine = ({ artistCredit, vocalRange }: TrackEmailTrack): string =>
  [creditText(artistCredit), rangeText(vocalRange)]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');

/**
 * The Track block under the featured title: the cover, then the track title and
 * the artist · range line. A missing cover adds no image, since email clients
 * show no placeholder.
 */
const trackDetailsHtml = (track: TrackEmailTrack): string => {
  const range = rangeText(track.vocalRange);
  const cover =
    track.coverUrl === null
      ? ''
      : `<img src="${escapeHtml(track.coverUrl)}" width="72" height="72" alt="" style="display:block;width:72px;height:72px;border:0;border-radius:12px;" />`;
  const rangeHtml =
    range === undefined
      ? ''
      : ` · <span style="font-family:'Geist Mono',monospace;white-space:nowrap;">${escapeHtml(range)}</span>`;
  return `<div style="margin-top:24px;">${cover}<p style="margin:16px 0 0;font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;">${escapeHtml(track.title)}</p><p style="margin:4px 0 0;font-size:15px;line-height:1.5;font-weight:600;letter-spacing:normal;">${escapeHtml(creditText(track.artistCredit))}${rangeHtml}</p></div>`;
};

const renderTrackEmail = (
  copy: TrackEmailCopy,
  { to, locale, trackUrl, webUrl, track }: TrackEmailInput & EmailWebOrigin,
): EmailMessage => {
  const text = [
    track.title,
    artistLine(track),
    '',
    copy.intro,
    '',
    copy.action,
    '',
    `${copy.link}: ${trackUrl}`,
  ];
  const html = renderEmailFromCopy(
    { locale, webUrl },
    copy,
    [
      emailParagraph(copy.intro),
      emailParagraph(copy.action),
      emailButton(trackUrl, copy.link),
    ].join('\n'),
    trackDetailsHtml(track),
  );
  return { to, subject: copy.subject, html, text: text.join('\n') };
};

/** Sent to every Contributor of a Track whose Processing completed. */
export const renderTrackCompletedEmail = (
  input: TrackEmailInput & EmailWebOrigin,
): EmailMessage => renderTrackEmail(COMPLETED[input.locale], input);

/** Sent to every Contributor of a Track whose Processing failed. */
export const renderTrackFailedEmail = (
  input: TrackEmailInput & EmailWebOrigin,
): EmailMessage => renderTrackEmail(FAILED[input.locale], input);
