import { useTranslation } from 'react-i18next';
import { BarChart } from '@mantine/charts';
import { formatMonthName } from '../../i18n/format';
import type { CentreComparison } from './month';

/**
 * Completed sessions per centre, this month against last month, as horizontal grouped bars (centre names on the
 * vertical axis so long names stay readable on a phone). Loaded lazily: recharts stays out of the main bundle.
 */
export default function SessionsChart({ rows, month, previousMonth }: { rows: CentreComparison[]; month: string; previousMonth: string }) {
  const { i18n } = useTranslation();
  const rtl = i18n.dir() === 'rtl';
  const longest = Math.max(...rows.map((r) => r.name.length), 4);
  return (
    // recharts lays out left to right; Arabic mirrors the axes instead
    <div dir="ltr">
      <BarChart
        h={Math.max(rows.length * 64 + 70, 160)}
        data={rows}
        dataKey="name"
        orientation="vertical"
        gridAxis="x"
        withLegend
        legendProps={{ verticalAlign: 'bottom', height: 40 }}
        barProps={{ radius: rtl ? [4, 0, 0, 4] : [0, 4, 4, 0] }}
        maxBarWidth={16}
        tooltipAnimationDuration={150}
        xAxisProps={{ reversed: rtl, allowDecimals: false }}
        yAxisProps={{
          orientation: rtl ? 'right' : 'left',
          width: Math.min(Math.max(longest * 7, 60), 120),
          ...(rtl ? { tick: { transform: 'translate(10, 0)', fontSize: 12, fill: 'currentColor' } } : {}),
        }}
        series={[
          { name: 'current', label: formatMonthName(month, i18n.language), color: 'var(--uoca-chart-gold)' },
          { name: 'previous', label: formatMonthName(previousMonth, i18n.language), color: 'var(--uoca-chart-blue)' },
        ]}
      />
    </div>
  );
}
