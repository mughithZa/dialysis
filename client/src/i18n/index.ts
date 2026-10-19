import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES, type Language } from '@dialysis/shared';
import ar from './ar.json';
import en from './en.json';

const STORAGE_KEY = 'language';

const isLanguage = (v: unknown): v is Language => typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);

/** The saved choice, else the browser's language when we have it, else Arabic (the centres' language). */
export function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // storage blocked: fall through to the browser language
  }
  const browser = (typeof navigator !== 'undefined' ? navigator.language : '').slice(0, 2);
  return isLanguage(browser) ? browser : 'ar';
}

/** Mirrors the language on <html> so the browser, fonts and screen readers lay out and read Arabic right to left. */
function applyToDocument(lng: string) {
  document.documentElement.lang = lng;
  document.documentElement.dir = i18n.dir(lng);
}

/** Switches the interface language and remembers it on this device. */
export async function setLanguage(lng: Language): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // not remembered on this device; the switch still applies
  }
  await i18n.changeLanguage(lng);
}

export const currentLanguage = (): Language => (isLanguage(i18n.language) ? i18n.language : 'en');

/**
 * Locale for dates and times. Arabic keeps Western digits so dates match the times, machine numbers and
 * amounts that come from the data.
 */
export const dateLocale = (lng: string = i18n.language): string => (lng === 'ar' ? 'ar-SY-u-nu-latn' : lng);

i18n.on('languageChanged', applyToDocument);

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGES],
  interpolation: { escapeValue: false },
});

export default i18n;
