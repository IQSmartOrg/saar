/**
 * The minutes of a meeting — the artefact the whole product exists to produce.
 *
 * A domain type, not a processing detail: the repository stores it and the UI
 * renders it, neither of which should have to know a summariser exists. How it
 * gets built lives in `src/processing`.
 */
export interface MeetingMinutes {
  readonly summary: string;
  readonly topics: readonly Topic[];
  readonly decisions: readonly Decision[];
  readonly actionItems: readonly ActionItem[];
  readonly openQuestions: readonly string[];
  /** Present when the model returned something we could not parse into shape. */
  readonly raw?: string;
}

export interface Topic {
  readonly title: string;
  readonly points: readonly string[];
  readonly speakers: readonly string[];
}

export interface Decision {
  readonly decision: string;
  readonly context: string;
}

export interface ActionItem {
  readonly owner: string;
  readonly task: string;
  readonly due: string | null;
  /**
   * Verbatim transcript text supporting the item. This is what makes output
   * from a small local model trustworthy — the user can check any claim
   * against the source rather than taking it on faith.
   */
  readonly quote: string;
}

export const EMPTY_MINUTES: MeetingMinutes = {
  summary: '',
  topics: [],
  decisions: [],
  actionItems: [],
  openQuestions: [],
};
