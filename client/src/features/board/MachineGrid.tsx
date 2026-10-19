import { Fragment, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, Stack, Text } from '@mantine/core';
import { STATUS_TONES, type StatusTone } from '../../theme';
import { useCentreId } from '../centre/api';
import type { BoardDto, BoardRow } from './api';
import classes from './MachineGrid.module.css';

export type TileState = 'active' | 'waiting' | 'completed' | 'did_not_come' | 'postponed' | 'free';

export interface MachineTile {
  chairId: string;
  label: string;
  row: BoardRow | null;
  /** Colour of the tile: the session's status (scheduled shows as waiting), or free. */
  tone: StatusTone | 'free';
  /** Legend group: postponed, cancelled and missed share one. */
  state: TileState;
}

const RANK: Record<string, number> = { active: 0, scheduled: 1, completed: 2 };
const rank = (r: BoardRow) => RANK[r.status] ?? 3;

function toneOf(row: BoardRow): { tone: StatusTone; state: TileState } {
  switch (row.status) {
    case 'scheduled':
      return { tone: 'waiting', state: 'waiting' };
    case 'active':
    case 'completed':
    case 'did_not_come':
      return { tone: row.status, state: row.status };
    default:
      return { tone: row.status, state: 'postponed' };
  }
}

/**
 * One tile per machine of the block, ordered by machine number. Tiles show the patient's name (first name first, clamped to two lines). A machine with several sessions shows the live one
 * (active, then waiting, then done) over a dead one (did not come, postponed, ...); a machine with none is free.
 */
export function machineTiles(d: BoardDto): MachineTile[] {
  const rows = [...d.active, ...d.waiting, ...d.done, ...d.didNotCome, ...d.other];
  const byChair = new Map<string, MachineTile>();
  for (const row of rows) {
    const had = byChair.get(row.chair.id);
    if (had?.row && rank(had.row) <= rank(row)) continue;
    byChair.set(row.chair.id, { chairId: row.chair.id, label: row.chairLabel, row, ...toneOf(row) });
  }
  for (const m of d.emptyMachines) {
    if (!byChair.has(m.id)) byChair.set(m.id, { chairId: m.id, label: m.label, row: null, tone: 'free', state: 'free' });
  }
  return [...byChair.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** Wraps only between words, so "Patient 1-03" never splits as "Patient 1-" / "03". */
export function NoBreakWords({ text }: { text: string }) {
  const words = text.trim().split(/\s+/);
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span style={{ whiteSpace: 'nowrap' }}>{w}</span>
        </Fragment>
      ))}
    </>
  );
}

export const toneVars = (tone: StatusTone | 'free'): CSSProperties | undefined =>
  tone === 'free' ? undefined : ({ '--tile-bg': STATUS_TONES[tone].bg, '--tile-fg': STATUS_TONES[tone].fg } as CSSProperties);

const LEGEND: { state: TileState; tone: StatusTone | 'free' }[] = [
  { state: 'active', tone: 'active' },
  { state: 'waiting', tone: 'waiting' },
  { state: 'completed', tone: 'completed' },
  { state: 'did_not_come', tone: 'did_not_come' },
  { state: 'postponed', tone: 'postponed' },
  { state: 'free', tone: 'free' },
];

/** At-a-glance picture of the block: a coloured tile per machine; tiles with a session open it. */
export function MachineGrid({ board }: { board: BoardDto }) {
  const { t } = useTranslation();
  const centreId = useCentreId();
  const tiles = machineTiles(board);
  if (tiles.length === 0) return null;
  const counts = new Map<TileState, number>();
  for (const tile of tiles) counts.set(tile.state, (counts.get(tile.state) ?? 0) + 1);

  return (
    <Card padding="sm">
      <Stack gap="sm">
        <Text fw={600}>{t('board.grid')}</Text>
        <div className={classes.grid} role="list" aria-label={t('board.grid')}>
          {tiles.map((tile) => {
            const body = (
              <>
                <span className={classes.label}>{tile.label}</span>
                <span className={classes.name}>{tile.row ? <NoBreakWords text={tile.row.patient.name} /> : t('board.free')}</span>
              </>
            );
            return (
              <div role="listitem" key={tile.chairId} style={{ display: 'contents' }}>
                {tile.row ? (
                  <Link
                    to={`/c/${centreId}/sessions/${tile.row.id}`}
                    className={classes.tile}
                    style={toneVars(tile.tone)}
                    data-tile-state={tile.state}
                    aria-label={t('board.tile', {
                      label: tile.label,
                      name: tile.row.patient.name,
                      status: t(`sessions.status.${tile.tone}`),
                    })}
                  >
                    {body}
                  </Link>
                ) : (
                  <div
                    className={`${classes.tile} ${classes.free}`}
                    data-tile-state="free"
                    aria-label={t('board.tileFree', { label: tile.label })}
                  >
                    {body}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className={classes.legend}>
          {LEGEND.filter((l) => counts.has(l.state)).map((l) => (
            <span key={l.state} className={classes.legendItem}>
              <span className={`${classes.swatch} ${l.tone === 'free' ? classes.swatchFree : ''}`} style={toneVars(l.tone)} aria-hidden />
              {t('board.legendCount', { label: t(`board.legend.${l.state}`), n: counts.get(l.state) })}
            </span>
          ))}
        </div>
      </Stack>
    </Card>
  );
}
