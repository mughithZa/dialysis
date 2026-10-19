import { test, expect, type Locator, type Page } from '@playwright/test';
import en from '../client/src/i18n/en.json' with { type: 'json' };

// The server address is only known once global-setup has started it.
test.use({ baseURL: process.env.E2E_BASE_URL });

const STAFF_PASSWORD = 'e2e-pass-1';
const PATIENT = { name: 'Test Patient', username: 'test.patient', password: 'patient-pass-1' };
const OTHER = { name: 'Other Patient', username: 'other.patient', password: 'patient-pass-2' };
const ORDER = 'Give EPO 4000 IU';
const DOCTOR_NOTE = 'Review dry weight next week';

/** Today's weekday (0 = Sunday) in the app timezone, which the browser context also uses. */
/** Today's weekday (0=Sunday) in the server's APP_TZ: this zone must match APP_TZ set for the server in e2e/global-setup.ts (and timezoneId in playwright.config.ts). */
function todayWeekday(): number {
  const short = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Damascus' }).format(new Date());
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short);
}
const dayName = (weekday: number) => en.desk.weekdays[String(weekday % 7) as keyof typeof en.desk.weekdays];

async function login(page: Page, username: string, password = STAFF_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel(en.login.username).fill(username);
  await page.getByLabel(en.login.password).fill(password);
  await page.getByRole('button', { name: en.login.submit }).click();
  await expect(page.getByRole('button', { name: en.login.submit })).toBeHidden();
}

/** Sign-out lives in the user menu (avatar in the header). */
async function logout(page: Page) {
  await page.getByRole('button', { name: en.userMenu.label }).click();
  await page.getByRole('menuitem', { name: en.common.logout }).click();
  await expect(page.getByRole('heading', { name: en.login.title })).toBeVisible();
}

// The phone footer tabs come after the (off-screen) side navigation in the DOM.
const goTo = (page: Page, label: string) => page.getByRole('link', { name: label, exact: true }).last().click();

/** Open a centre-scoped page by URL (some entries only sit in the phone "More" drawer). */
async function visit(page: Page, path: string) {
  const centreId = /\/c\/([^/]+)\//.exec(page.url())?.[1];
  expect(centreId).toBeTruthy();
  await page.goto(`/c/${centreId}/${path}`);
}

async function pick(page: Page, label: string, option: string, scope: Page | Locator = page) {
  await scope.getByRole('textbox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function registerPatient(page: Page, p: typeof PATIENT) {
  await goTo(page, en.nav.patients);
  await page.getByRole('button', { name: en.desk.patients.new }).click();
  await page.getByLabel(en.desk.form.name, { exact: true }).fill(p.name);
  await page.getByLabel(en.desk.form.username, { exact: true }).fill(p.username);
  await page.getByLabel(en.desk.form.password, { exact: true }).fill(p.password);
  await page.getByRole('button', { name: en.common.create, exact: true }).click();
  await expect(page.getByText(en.desk.patients.created)).toBeVisible();
}

/** One day row of the booking dialog: weekday, block, machine. */
async function fillDayRow(page: Page, n: number, weekday: number, block: string, machine: string) {
  const row = page.getByRole('group', { name: en.desk.book.dayN.replace('{{n}}', String(n)) });
  await pick(page, en.desk.book.weekday, dayName(weekday), row);
  await pick(page, en.desk.book.block, block, row);
  await pick(page, en.desk.book.machine, en.desk.calendar.machine.replace('{{label}}', machine), row);
}

/** A patient's card on the board (not the machine grid, which also names the patient). */
const card = (page: Page, text: string) =>
  page.locator('.mantine-Card-root', { hasText: text }).filter({ hasNot: page.locator('[data-tile-state]') });

test('core flow: desk builds the schedule, rosters and books; doctor notes; nurse runs the session; timelines and dashboard agree', async ({ page }) => {
  const today = todayWeekday();
  const tomorrow = (today + 1) % 7;

  // 1. Front desk builds the schedule: 4 machines, 08:00-16:00, 2 session blocks (the centre runs every day).
  await login(page, 'desk');
  await visit(page, 'setup');
  await page.getByLabel(en.desk.setup.machineCount).fill('4');
  await page.getByLabel(en.desk.setup.dayStart).fill('08:00');
  await page.getByLabel(en.desk.setup.dayEnd).fill('16:00');
  await page.getByLabel(en.desk.setup.sessionCount).fill('2');
  await page.getByRole('button', { name: en.desk.setup.propose }).click();
  await expect(page.getByLabel(en.desk.setup.blockName.replace('{{n}}', '1'))).toHaveValue('Session 1');
  await expect(page.getByLabel(en.desk.setup.blockStart.replace('{{n}}', '2'))).toHaveValue('12:00');
  await page.getByRole('button', { name: en.desk.setup.save, exact: true }).click();
  await expect(page.getByText(en.desk.setup.saved)).toBeVisible();

  // 2. Roster: nurse Nora on Session 1, all machines, for today.
  await goTo(page, en.nav.schedule);
  await page.getByRole('link', { name: en.desk.schedule.assignNurses }).click();
  await pick(page, en.desk.roster.nurse, 'Nurse Nora');
  await page.getByText('Session 1', { exact: true }).click();
  await page.getByText(en.desk.roster.session, { exact: true }).click();
  await page.getByRole('button', { name: en.desk.roster.assign, exact: true }).click();
  await expect(page.getByText(en.desk.roster.saved)).toBeVisible();

  // 3. Two patients. The first is booked weekly: today's weekday Session 1 machine 1 and tomorrow's weekday
  //    Session 2 machine 2. The second is booked once: today Session 1 machine 2.
  await registerPatient(page, PATIENT);
  await registerPatient(page, OTHER);

  await page.getByRole('link', { name: new RegExp(PATIENT.name) }).click();
  await page.getByRole('button', { name: en.desk.patient.bookPattern }).click();
  await fillDayRow(page, 1, today, 'Session 1', '1');
  await page.getByRole('button', { name: en.desk.book.addDay }).click();
  await fillDayRow(page, 2, tomorrow, 'Session 2', '2');
  await page.getByRole('button', { name: en.desk.book.book, exact: true }).click();
  await expect(page.getByText(en.desk.book.booked)).toBeVisible();
  const planLine = (day: number, block: string, chair: string) =>
    en.desk.patient.planLine.replace('{{day}}', dayName(day)).replace('{{block}}', block).replace('{{chair}}', chair);
  await page.getByRole('tab', { name: en.desk.patient.tabs.schedule }).click();
  await expect(page.getByText(planLine(today, 'Session 1', '1'))).toBeVisible();
  await expect(page.getByText(planLine(tomorrow, 'Session 2', '2'))).toBeVisible();

  await goTo(page, en.nav.patients);
  await page.getByRole('link', { name: new RegExp(OTHER.name) }).click();
  await page.getByRole('button', { name: en.desk.patient.bookPattern }).click();
  await page.getByText(en.desk.book.repeatOnce, { exact: true }).click();
  await fillDayRow(page, 1, today, 'Session 1', '2');
  await page.getByRole('button', { name: en.desk.book.book, exact: true }).click();
  await expect(page.getByText(en.desk.book.booked)).toBeVisible();
  await logout(page);

  // 4. Doctor adds a patient note and an order.
  await login(page, 'doctor');
  await goTo(page, en.nav.patients);
  // wait for the list: the Today board the doctor lands on also links the patient (machine grid)
  await expect(page.getByRole('heading', { name: en.desk.patients.title })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(PATIENT.name) }).click();
  // doctors land on Trends (no vitals yet); orders and notes are written from the Orders tab's one "New" action
  await expect(page.getByText(en.doctor.trends.empty)).toBeVisible();
  await page.getByRole('tab', { name: en.desk.patient.tabs.orders }).click();
  await page.getByRole('button', { name: en.doctor.new }).click();
  await page.getByRole('dialog').getByLabel(en.doctor.orders.text).fill(ORDER);
  await page.getByRole('dialog').getByRole('button', { name: en.doctor.orders.add }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(ORDER).first()).toBeVisible();
  await page.getByRole('button', { name: en.doctor.new }).click();
  await page.getByRole('dialog').getByText(en.doctor.kind.note, { exact: true }).click();
  await page.getByRole('dialog').getByLabel(en.doctor.notes.text).fill(DOCTOR_NOTE);
  await page.getByRole('dialog').getByRole('button', { name: en.doctor.notes.add, exact: true }).click();
  await expect(page.getByText(en.doctor.notes.added)).toBeVisible();
  await logout(page);

  // 5. Nurse sees the row on the board under "My machines" with the orders flag, starts it, records Heparin 5 cc, closes.
  await login(page, 'nurse');
  await expect(page.getByRole('heading', { name: en.nav.today })).toBeVisible();
  await page.getByText('Session 1', { exact: true }).click();
  await expect(page.getByLabel(en.board.mine)).toBeChecked();
  const mine = card(page, PATIENT.name);
  await expect(mine.getByText(en.board.orders, { exact: true })).toBeVisible();
  await expect(card(page, OTHER.name)).toHaveCount(1); // rostered on all machines, so both are "mine"
  await mine.getByRole('button', { name: en.board.start, exact: true }).click();
  await expect(page.getByText(en.nurse.session.opened)).toBeVisible();
  // Start goes straight to the session page
  await expect(page.getByRole('button', { name: en.nurse.session.close })).toBeVisible();
  await expect(page.getByText(ORDER)).toBeVisible();

  await page.getByRole('button', { name: en.nurse.usage.add, exact: true }).click();
  await page.getByRole('button', { name: 'Heparin', exact: true }).click();
  await page.getByLabel(en.nurse.usage.amount).fill('5');
  await page.getByRole('button', { name: en.nurse.usage.save, exact: true }).click();
  await expect(page.locator('[data-usage-line]', { hasText: 'Heparin' })).toContainText('5 cc');

  await page.getByRole('button', { name: en.nurse.session.close, exact: true }).click();
  await expect(page.getByText(en.nurse.session.closed)).toBeVisible();
  await expect(page.getByText(en.nurse.session.noHeparin)).toBeHidden(); // heparin was recorded: no warning
  await logout(page);

  // 6. Front desk marks the other patient's session Did not come, from the board.
  await login(page, 'desk');
  await page.getByText('Session 1', { exact: true }).click();
  await card(page, OTHER.name).getByRole('button', { name: en.board.didNotCome, exact: true }).click();
  await page.getByRole('button', { name: en.desk.didNotCome.confirm, exact: true }).click();
  await expect(page.getByText(en.desk.didNotCome.done)).toBeVisible();
  await expect(page.getByText(/Did not come 1/)).toBeVisible();

  // 7. The patient's timeline (front desk view) shows Completed with Heparin 5 cc, and the doctor note.
  await goTo(page, en.nav.patients);
  await page.getByRole('link', { name: new RegExp(PATIENT.name) }).click();
  const done = page.locator('[data-testid^="timeline-row-"]', { hasText: en.sessions.status.completed });
  await expect(done.getByText('Heparin: 5 cc')).toBeVisible();
  await expect(page.locator('[data-testid^="timeline-note-"]', { hasText: DOCTOR_NOTE })).toBeVisible();
  await logout(page);

  // 8. The patient logs in and sees Completed with Heparin 5 cc on the same timeline.
  await login(page, PATIENT.username, PATIENT.password);
  await expect(page.getByRole('heading', { name: PATIENT.name })).toBeVisible();
  await expect(page.getByText('Heparin: 5 cc')).toBeVisible();
  await expect(page.getByText(en.sessions.status.completed)).toBeVisible();
  await logout(page);

  // 9. Programme manager's dashboard for this month: 1 session (completed only), Heparin 5 cc.
  await login(page, 'pm');
  await goTo(page, en.nav.dashboard);
  const stats = page.locator('[data-centre-stats]', { hasText: 'E2E Centre' });
  await expect(stats.getByText(en.pm.dashboard.sessions).locator('xpath=preceding-sibling::*[1]')).toHaveText('1');
  await expect(stats.getByRole('row', { name: /Heparin\s+5\s+cc/ })).toBeVisible();
});
