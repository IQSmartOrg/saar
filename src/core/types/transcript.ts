export type TranscriptSourceKind =
  | 'meet-captions'
  | 'teams-captions'
  | 'audio-whisper';

export interface TranscriptSegment {
  readonly id: string;
  readonly final: boolean;
  readonly speaker: string | null;
  readonly text: string;
  readonly tStart: number;
  readonly tEnd: number;
  readonly source: TranscriptSourceKind;
  readonly confidence?: number;
}
