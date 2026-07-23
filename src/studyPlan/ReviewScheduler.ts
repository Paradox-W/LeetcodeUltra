import { Card, FSRS, Rating, State } from "fsrs.js";
import {
  ReviewScheduler,
  SchedulerPreview,
  SchedulerRateResult,
  SerializableFsrsCard,
  StudyRating,
} from "./StudyPlanTypes";

const RATING_MAP: { [key in StudyRating]: Rating } = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

function validDate(value: string | Date | undefined, fallback: Date): Date {
  const date = value instanceof Date ? value : new Date(value || "");
  return Number.isNaN(date.getTime()) ? fallback : date;
}
function toSerializable(card: Card, now: Date): SerializableFsrsCard {
  return {
    due: validDate(card.due, now).toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: Math.min(365, Math.max(0, card.scheduled_days)),
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: validDate(card.last_review, now).toISOString(),
  };
}

function fromSerializable(card: SerializableFsrsCard | undefined, now: Date): Card {
  const value = new Card();
  if (!card) {
    value.due = now;
    value.last_review = now;
    return value;
  }
  value.due = validDate(card.due, now);
  value.stability = Number(card.stability) || 0;
  value.difficulty = Number(card.difficulty) || 0;
  value.elapsed_days = Number(card.elapsed_days) || 0;
  value.scheduled_days = Math.min(365, Math.max(0, Number(card.scheduled_days) || 0));
  value.reps = Number(card.reps) || 0;
  value.lapses = Number(card.lapses) || 0;
  value.state = card.state in State ? card.state : State.New;
  value.last_review = validDate(card.last_review, now);
  return value;
}

export class FsrsReviewScheduler implements ReviewScheduler {
  private readonly fsrs: FSRS;

  constructor(targetRetention = 0.9, maximumIntervalDays = 365) {
    this.fsrs = new FSRS();
    this.fsrs.p.request_retention = targetRetention;
    this.fsrs.p.maximum_interval = maximumIntervalDays;
  }

  public preview(card: SerializableFsrsCard | undefined, now: Date): SchedulerPreview[] {
    const schedule = this.fsrs.repeat(fromSerializable(card, now), now);
    return (Object.keys(RATING_MAP) as StudyRating[]).map((rating) => {
      const info = schedule[RATING_MAP[rating]];
      return {
        rating,
        due: validDate(info.card.due, now).toISOString(),
        intervalDays: Math.min(365, Math.max(0, Number(info.card.scheduled_days) || 0)),
        minuteLevel: validDate(info.card.due, now).getTime() - now.getTime() < 24 * 60 * 60 * 1000,
      };
    });
  }

  public rate(
    card: SerializableFsrsCard | undefined,
    rating: StudyRating,
    now: Date
  ): SchedulerRateResult {
    const schedule = this.fsrs.repeat(fromSerializable(card, now), now);
    const info = schedule[RATING_MAP[rating]];
    const serializable = toSerializable(info.card, now);
    return {
      rating,
      card: serializable,
      due: serializable.due,
      intervalDays: serializable.scheduled_days,
      minuteLevel: new Date(serializable.due).getTime() - now.getTime() < 24 * 60 * 60 * 1000,
    };
  }

  public isDue(card: SerializableFsrsCard | undefined, now: Date): boolean {
    return !!card && validDate(card.due, now).getTime() <= now.getTime();
  }
}
