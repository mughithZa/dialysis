import type { Language } from '@dialysis/shared';

/** Server-side message map, one entry per interface language. */
export interface Messages {
  reminderTitle: string;
  reminderBody: (weekday: string, date: string, start: string, chair: string) => string;
  /** 0 = Sunday. */
  weekdays: string[];
}

export const en: Messages = {
  reminderTitle: 'Dialysis session',
  reminderBody: (weekday, date, start, chair) => `${weekday} ${date} at ${start}, chair ${chair}`,
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

export const ar: Messages = {
  reminderTitle: 'جلسة غسيل الكلى',
  reminderBody: (weekday, date, start, chair) => `${weekday} ${date} الساعة ${start}، الكرسي ${chair}`,
  weekdays: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};

/** Messages in the user's language; English when the user never chose one. */
export const messagesFor = (language: Language | null | undefined): Messages => (language === 'ar' ? ar : en);
