import { Card, CardContent, Stack, Typography } from '@mui/material';

export default function StatCard({ label, value, hint, tone = 'default' }) {
  const color = tone === 'positive' ? 'success.main' : tone === 'negative' ? 'error.main' : 'text.primary';
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack spacing={0.5}>
          <Typography variant="overline" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Typography>
          {hint ? (
            <Typography variant="caption" color="text.secondary">
              {hint}
            </Typography>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
