import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import SyncIcon from '@mui/icons-material/Sync';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import { Box, Button, Chip, Tooltip } from '@mui/material';
import { useData } from '../offline/DataProvider.jsx';
import { relativeTime } from '../format.js';

/**
 * Connectivity is a first-class piece of UI here. If the user cannot tell
 * whether their trade has reached the server, they will re-enter it.
 */
export default function SyncStatus() {
  const { online, status, queue, sync } = useData();
  const unsynced = queue.filter((op) => !op.rejected).length;
  const rejected = queue.filter((op) => op.rejected).length;

  const chip = (() => {
    if (rejected) {
      return { label: `${rejected} need${rejected === 1 ? 's' : ''} attention`, color: 'error', icon: <SyncProblemIcon /> };
    }
    if (!online) {
      return { label: unsynced ? `Offline · ${unsynced} queued` : 'Offline', color: 'warning', icon: <CloudOffIcon /> };
    }
    if (status.state === 'syncing') return { label: 'Syncing…', color: 'info', icon: <SyncIcon /> };
    if (unsynced) return { label: `${unsynced} queued`, color: 'warning', icon: <SyncIcon /> };
    return { label: `Synced ${relativeTime(status.lastSyncAt)}`, color: 'success', icon: <CloudDoneIcon /> };
  })();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Tooltip
        title={
          online
            ? 'Changes are saved on this device first, then pushed to the server.'
            : 'Working offline — every change is saved locally and will sync automatically.'
        }
      >
        <Chip size="small" icon={chip.icon} color={chip.color} variant="outlined" label={chip.label} />
      </Tooltip>
      <Button size="small" onClick={() => sync({ force: true })} disabled={status.state === 'syncing'}>
        Sync now
      </Button>
    </Box>
  );
}
