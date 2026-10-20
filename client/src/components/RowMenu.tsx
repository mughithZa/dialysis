import type { ReactNode } from 'react';
import { ActionIcon, Menu } from '@mantine/core';
import { IconDots, type Icon } from '@tabler/icons-react';

export interface RowMenuItem {
  label: string;
  icon: Icon;
  onClick: () => void;
  /** Red, after a divider (close, discharge, ...). */
  danger?: boolean;
}

/** A row's "⋯" menu: the row's less frequent actions behind one 44 px button. Renders nothing without items. */
export function RowMenu({ label, items, loading }: { label: string; items: (RowMenuItem | false | null | undefined)[]; loading?: boolean }) {
  const shown = items.filter((i): i is RowMenuItem => !!i);
  if (shown.length === 0) return null;
  const plain = shown.filter((i) => !i.danger);
  const danger = shown.filter((i) => i.danger);
  const item = (i: RowMenuItem): ReactNode => (
    <Menu.Item key={i.label} mih={44} color={i.danger ? 'danger' : undefined} leftSection={<i.icon size={16} />} onClick={i.onClick}>
      {i.label}
    </Menu.Item>
  );
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="uoca" size={44} aria-label={label} loading={loading} style={{ flexShrink: 0 }}>
          <IconDots size={20} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {plain.map(item)}
        {plain.length > 0 && danger.length > 0 && <Menu.Divider />}
        {danger.map(item)}
      </Menu.Dropdown>
    </Menu>
  );
}
