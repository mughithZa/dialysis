import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconUsers } from '@tabler/icons-react';
import { renderApp } from '../test/render';
import { EmptyState } from './EmptyState';
import { PageHeader } from './PageHeader';
import { StatCard } from './StatCard';

describe('EmptyState', () => {
  it('shows an icon, the title and the hint', async () => {
    const { container } = renderApp(<EmptyState icon={IconUsers} title="No patients found." hint="Try another search." />);
    expect(await screen.findByText('No patients found.')).toBeInTheDocument();
    expect(screen.getByText('Try another search.')).toBeInTheDocument();
    expect(container.querySelector('[data-empty-state] svg')).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers the optional action', async () => {
    const onClick = vi.fn();
    renderApp(<EmptyState title="No patients found." action={{ label: 'New patient', onClick }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'New patient' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('PageHeader and StatCard', () => {
  it('renders a title, subtitle and action', async () => {
    renderApp(<PageHeader title="Patients" subtitle="12 active" action={<button type="button">Add</button>} />);
    expect(await screen.findByRole('heading', { name: 'Patients' })).toBeInTheDocument();
    expect(screen.getByText('12 active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('renders a big number with its label', async () => {
    renderApp(<StatCard value={42} label="Sessions" icon={IconUsers} />);
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });
});
