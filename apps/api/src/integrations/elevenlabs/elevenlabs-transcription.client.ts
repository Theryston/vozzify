import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { type Transcription, transcriptionOf } from './scribe-output.js';

// Scribe v2, pinned: the model the Timed lyrics are transcribed with. Fixed,
// never env-configurable, so every Processing is transcribed the same way.
const SCRIBE_MODEL_ID = 'scribe_v2';

// A full song transcribes well within this; a hung request is cut here instead
// of holding the Processing's lyrics step open.
const REQUEST_TIMEOUT_SECONDS = 300;

/** One transcription: the vocals as MP3. No Lyrics guidance is ever sent. */
export type TranscriptionInput = {
  audio: Uint8Array<ArrayBuffer>;
};

/**
 * The Scribe v2 call the client makes, with its options fixed: word-level
 * timestamps, diarization on with automatic speaker count (no `numSpeakers`),
 * language auto-detected (no `languageCode`), audio-event tagging off and
 * verbatim cleanup off (a literal transcript), synchronous (no webhook). Tests
 * inject a stub for this transport; the default calls the official SDK.
 */
export type ScribeConvert = (
  request: {
    file?: Uint8Array<ArrayBuffer>;
    sourceUrl?: string;
    modelId: typeof SCRIBE_MODEL_ID;
    timestampsGranularity: 'word';
    diarize: true;
    tagAudioEvents: false;
    noVerbatim: false;
  },
  requestOptions: { timeoutInSeconds: number },
) => Promise<unknown>;

/** The official SDK's speech-to-text, called with the fixed options. */
const convertOf = (apiKey: string): ScribeConvert => {
  const speechToText = new ElevenLabsClient({ apiKey }).speechToText;
  return (request, requestOptions) =>
    speechToText.convert(request, requestOptions);
};

/**
 * Transcribes a Processing's vocals with ElevenLabs' Scribe v2: the official
 * SDK is the only code that calls it. Features depend on this class, so tests
 * replace it at this boundary.
 */
export class ElevenLabsTranscriptionClient {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly convert?: ScribeConvert,
  ) {}

  async transcribe(
    input: TranscriptionInput | { sourceUrl: string },
  ): Promise<Transcription> {
    const apiKey = this.configuredKey();
    const convert = this.convert ?? convertOf(apiKey);
    const answer = await convert(
      {
        ...('audio' in input
          ? { file: input.audio }
          : { sourceUrl: input.sourceUrl }),
        modelId: SCRIBE_MODEL_ID,
        timestampsGranularity: 'word',
        diarize: true,
        tagAudioEvents: false,
        noVerbatim: false,
      },
      { timeoutInSeconds: REQUEST_TIMEOUT_SECONDS },
    );
    return transcriptionOf(answer);
  }

  private configuredKey(): string {
    if (this.apiKey === undefined) {
      throw new Error('ELEVENLABS_API_KEY is not set');
    }
    return this.apiKey;
  }
}
