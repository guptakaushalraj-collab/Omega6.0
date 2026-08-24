import { Box, Card, CardContent, Typography } from '@mui/material';
import { PieChart } from '@mui/x-charts/PieChart';
import { money, percent } from '../format.js';

// A brand-neutral categorical ramp: distinguishable at small sizes and in both
// light and dark themes.
const COLORS = ['#1b5e5f', '#f2b544', '#5b7fb9', '#8f6bb5', '#4f9d69', '#c0705a'];

export default function AllocationChart({ allocation, currency = 'USD' }) {
  const total = allocation.reduce((sum, slice) => sum + slice.market_value, 0);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h2" gutterBottom>
          Allocation
        </Typography>
        {allocation.length === 0 || total === 0 ? (
          <Typography color="text.secondary" variant="body2">
            Allocation appears once positions have a synced price.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <PieChart
              height={240}
              series={[
                {
                  innerRadius: 55,
                  outerRadius: 100,
                  paddingAngle: 2,
                  cornerRadius: 4,
                  data: allocation.map((slice, index) => ({
                    id: slice.asset_class,
                    value: slice.market_value,
                    label: `${slice.asset_class} · ${percent(slice.weight, 1).replace('+', '')}`,
                    color: COLORS[index % COLORS.length],
                  })),
                  valueFormatter: (item) => money(item.value, currency),
                },
              ]}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
