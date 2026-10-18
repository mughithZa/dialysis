/** Server-side message map; add other locales (e.g. `ar`) alongside `en` later. */
export const en = {
  reminderTitle: 'Dialysis session',
  reminderBody: (weekday: string, date: string, start: string, chair: string) =>
    `${weekday} ${date} at ${start}, chair ${chair}`,
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

export const messages = en;
