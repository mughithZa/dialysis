import { test, expect, type Page } from '@playwright/test';
import en from '../client/src/i18n/en.json' with { type: 'json' };

// The server address is only known once global-setup has started it.
test.use({ baseURL: process.env.E2E_BASE_URL });

const STAFF_PASSWORD = 'e2e-pass-1';
const PATIENT = { name: 'Test Patient', username: 'test.patient', password: 'patient-pass-1' };
const ORDER = 'Give EPO 4000 IU';
const NOTE = 'Stable';

/** Today's weekday (0 = Sunday) in the app timezone, which the browser context also uses. */
function todayWeekday(): number {
  const short = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Damascus' }).format(new Date());
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short);
}

async function login(page: Page, username: string, password = STAFF_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel(en.login.username).fill(username);
  await page.getByLabel(en.login.password).fill(password);
  await page.getByRole('button', { name: en.login.submit }).click();
  await expect(page.getByRole('button', { name: en.login.submit })).toBeHidden();
}

/** Phone layout: sign-out lives in the "More" drawer. */
async function logout(page: Page) {
  await page.getByText(en.common.more, { exact: true }).click();
  await page.getByRole('button', { name: en.common.logout }).click();
  await expect(page.getByRole('heading', { name: en.login.title })).toBeVisible();
}

// The phone footer tabs come after the (off-screen) side navigation in the DOM.
const goTo = (page: Page, label: string) => page.getByRole('link', { name: label, exact: true }).last().click();

async function pick(page: Page, label: string, option: string) {
  await page.getByRole('textbox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('core flow: desk books, doctor orders, nurse runs the session, patient and programme manager see it', async ({ page }) => {
  // 1. Front desk registers the patient, books today's weekday and assigns the nurse to the chair.
  await login(page, 'desk');
  await goTo(page, en.nav.patients);
  await page.getByRole('button', { name: en.desk.patients.new }).click();
  await page.getByLabel(en.desk.form.name, { exact: true }).fill(PATIENT.name);
  await page.getByLabel(en.desk.form.username, { exact: true }).fill(PATIENT.username);
  await page.getByLabel(en.desk.form.password, { exact: true }).fill(PATIENT.password);
  await page.getByRole('button', { name: en.common.create, exact: true }).click();
  await page.getByRole('link', { name: new RegExp(PATIENT.name) }).click();

  await page.getByRole('button', { name: en.desk.patient.bookPattern }).click();
  await pick(page, en.desk.book.chair, '1');
  await pick(page, en.desk.book.shift, 'Morning');
  await page.getByText(en.desk.weekdays[String(todayWeekday()) as keyof typeof en.desk.weekdays], { exact: true }).click();
  await page.getByRole('button', { name: en.desk.book.book, exact: true }).click();
  await expect(page.getByText(en.desk.book.booked)).toBeVisible();
  await expect(page.getByText(en.desk.patient.chairShift.replace('{{chair}}', '1').replace('{{shift}}', 'Morning'))).toBeVisible();

  await goTo(page, en.nav.schedule);
  await page.getByRole('link', { name: en.desk.schedule.assignNurses }).click();
  await pick(page, '1', 'Nurse Nora');
  await expect(page.getByText(en.desk.assign.saved)).toBeVisible();
  await logout(page);

  // 2. Doctor writes the order.
  await login(page, 'doctor');
  await goTo(page, en.nav.patients);
  await page.getByRole('link', { name: new RegExp(PATIENT.name) }).click();
  await page.getByLabel(en.doctor.orders.text).fill(ORDER);
  await page.getByRole('button', { name: en.doctor.orders.add }).click();
  await expect(page.getByText(ORDER)).toBeVisible();
  await logout(page);

  // 3. Nurse finds the session under "My chairs", sees the order, records usage, vitals and a note, closes.
  await login(page, 'nurse');
  await expect(page.getByRole('button', { name: new RegExp(`${en.nurse.today.mine} \\(1\\)`) })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(PATIENT.name) }).click();
  await expect(page.getByText(ORDER)).toBeVisible();
  await page.getByRole('button', { name: en.nurse.session.open }).click();
  await expect(page.getByText(en.nurse.session.opened)).toBeVisible();

  const addUsage = async (item: string, amount: string) => {
    await page.getByRole('button', { name: en.nurse.usage.add, exact: true }).click();
    await page.getByRole('button', { name: item, exact: true }).click();
    await page.getByLabel(en.nurse.usage.amount).fill(amount);
    await page.getByRole('button', { name: en.nurse.usage.save, exact: true }).click();
    await expect(page.getByText(en.nurse.usage.added).first()).toBeVisible();
  };
  await addUsage('Heparin', '5');
  await expect(page.getByText('Heparin: 5 cc')).toBeVisible();
  await addUsage('EPO', '4000');
  await expect(page.getByText('EPO: 4000 IU')).toBeVisible();

  await page.getByLabel(en.nurse.vitals.systolic).fill('120');
  await page.getByLabel(en.nurse.vitals.diastolic).fill('80');
  await page.getByRole('button', { name: en.nurse.vitals.addBp, exact: true }).click();
  await expect(page.getByText('BP 120/80')).toBeVisible();

  await page.getByLabel(en.nurse.notes.add, { exact: true }).fill(NOTE);
  await page.getByRole('button', { name: en.nurse.notes.save, exact: true }).click();
  await expect(page.getByText(en.nurse.notes.added)).toBeVisible();

  await page.getByRole('button', { name: en.nurse.session.close, exact: true }).click();
  await expect(page.getByText(en.nurse.session.closed)).toBeVisible();
  await expect(page.getByText(en.nurse.session.noHeparin)).toBeHidden(); // heparin was recorded: no warning
  await logout(page);

  // 4. Doctor sees the closed session in the patient's history, with the note.
  await login(page, 'doctor');
  await goTo(page, en.nav.patients);
  await page.getByRole('link', { name: new RegExp(PATIENT.name) }).click();
  await expect(page.getByText(en.sessions.status.completed)).toBeVisible();
  await expect(page.getByText(`${NOTE} (Nurse Nora)`)).toBeVisible();
  await expect(page.getByText('Heparin: 5 cc')).toBeVisible();
  await logout(page);

  // 5. Patient logs in and sees the session with Heparin 5 cc.
  await login(page, PATIENT.username, PATIENT.password);
  await expect(page.getByRole('heading', { name: PATIENT.name })).toBeVisible();
  await page.getByRole('link', { name: en.me.history }).click();
  await expect(page.getByText('Heparin: 5 cc')).toBeVisible();
  await expect(page.getByText(en.me.status.completed)).toBeVisible();
  await logout(page);

  // 6. Programme manager's dashboard for this month: 1 session, 1 patient, Heparin 5 cc.
  await login(page, 'pm');
  await goTo(page, en.nav.dashboard);
  const card = page.locator('[data-centre-stats]', { hasText: 'E2E Centre' });
  await expect(card.getByText(en.pm.dashboard.sessions).locator('xpath=following-sibling::*[1]')).toHaveText('1');
  await expect(card.getByText(en.pm.dashboard.patients).locator('xpath=following-sibling::*[1]')).toHaveText('1');
  await expect(card.getByRole('row', { name: /Heparin\s+5\s+cc/ })).toBeVisible();
});
