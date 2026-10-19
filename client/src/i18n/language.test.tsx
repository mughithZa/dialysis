import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DirectionProvider } from '@mantine/core';
import i18n, { dateLocale, initialLanguage, setLanguage } from '.';
import { DirectionSync, LanguageSwitch } from './LanguageSwitch';
import { formatDay } from '../components/timelineApi';
import { roleLabel } from './roleLabel';
import { formatDate, formatList, timeRange } from './format';
import { renderApp } from '../test/render';

afterEach(async () => {
  await setLanguage('en');
  localStorage.clear();
});

describe('interface language', () => {
  it('Arabic switches the document to right-to-left and is remembered; English switches back', async () => {
    await setLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(localStorage.getItem('language')).toBe('ar');
    expect(i18n.t('nav.today')).toBe('اليوم');
    await setLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(i18n.t('nav.today')).toBe('Today');
  });

  it('starts from the saved choice, else the browser language, else Arabic', () => {
    localStorage.setItem('language', 'ar');
    expect(initialLanguage()).toBe('ar');
    localStorage.clear();
    expect(initialLanguage()).toBe('en'); // jsdom's navigator.language is en-US
    localStorage.setItem('language', 'fr');
    expect(initialLanguage()).toBe('en');
  });

  it('uses Arabic plural forms', async () => {
    await setLanguage('ar');
    expect(i18n.t('board.hidden', { count: 1 })).toBe('جهاز آخر واحد مخفي.');
    expect(i18n.t('board.hidden', { count: 2 })).toBe('جهازان آخران مخفيان.');
    expect(i18n.t('board.hidden', { count: 5 })).toBe('5 أجهزة أخرى مخفية.');
  });

  it('formats dates in Arabic with Western digits', async () => {
    await setLanguage('ar');
    expect(dateLocale()).toBe('ar-SY-u-nu-latn');
    const day = formatDay('2026-10-19', 'ar');
    expect(day).toMatch(/الاثنين/);
    expect(day).toMatch(/19/);
  });

  it('shows full dates and lists without hyphens or Latin commas in Arabic, so right-to-left text cannot reorder them', async () => {
    await setLanguage('ar');
    expect(formatDate('2026-10-23')).toBe('23 تشرين الأول 2026');
    expect(formatList(['1', '2', '3'])).toBe('1، 2، 3');
    await setLanguage('en');
    expect(formatDate('2026-10-23')).toBe('Oct 23, 2026');
    expect(formatList(['1', '2', '3'])).toBe('1, 2, 3');
  });

  it('keeps time ranges reading start to end in Arabic', async () => {
    expect(timeRange('07:00', '11:30')).toBe('07:00–11:30');
    await setLanguage('ar');
    expect(timeRange('07:00', '11:30')).toBe('\u206607:00–11:30\u2069');
  });

  it('the picker switches the language and Mantine\'s direction', async () => {
    renderApp(
      <DirectionProvider initialDirection="ltr" detectDirection={false}>
        <DirectionSync />
        <LanguageSwitch />
      </DirectionProvider>,
    );
    await userEvent.click(screen.getByText('العربية'));
    await waitFor(() => expect(i18n.language).toBe('ar'));
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByText('اللغة')).toBeInTheDocument();
  });

  it('shows built-in role names in the interface language, custom names as typed', async () => {
    await setLanguage('ar');
    expect(roleLabel(i18n.t, { key: 'front_desk', name: 'Front desk' })).toBe('الاستقبال');
    expect(roleLabel(i18n.t, { key: 'front_desk', name: 'Reception (day)' })).toBe('Reception (day)');
    expect(roleLabel(i18n.t, { key: 'custom_1', name: 'Pharmacist' })).toBe('Pharmacist');
  });
});
