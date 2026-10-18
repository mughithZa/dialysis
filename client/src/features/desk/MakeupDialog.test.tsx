import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MakeupDialog } from './MakeupDialog';
import { addDaysLocal, todayLocal } from './dates';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useCentreUser } from '../../test/auth';

describe('MakeupDialog', () => {
  it('limits the date to today through the 3-day make-up window', async () => {
    useCentreUser(['schedule.makeup', 'schedule.view']);
    server.use(http.get('*/api/centres/c1/schedule/setup', () => HttpResponse.json({ machines: [], blocks: [], workingDays: [] })));
    renderApp(<MakeupDialog patientId="p1" onDone={() => {}} />);
    const date = screen.getByLabelText('Date');
    expect(date).toHaveAttribute('min', todayLocal());
    expect(date).toHaveAttribute('max', addDaysLocal(3));
  });
});
