// InventoryPreview — "read exactly what you are about to send", for the inventory dump (JOS-296).
//
// LogPreview's twin, and deliberately its twin rather than its cousin: the rows render in the
// SAME fixed-height windowed box (`PreviewLines`, exported from LogPreview) and the size is
// stated in the SAME vocabulary (`formatBytes`). Two attachments in one dialog that described
// themselves two different ways would read as two features.
//
// WHAT IS DIFFERENT, and why:
//
//   * THE META LINE LEADS WITH AGE, not with counts. `updated 3d ago` is the single most
//     diagnostic fact about an export — it is what turns "the app says I don't own that item"
//     into an answer — and it comes from the JOS-253 freshness truth (`outputAgeLabel` over the
//     dump's mtime), the same words every other surface in this app uses for the same file.
//   * THERE IS NO "Save a copy…". The slice needs one because the slice is a thing this app
//     MADE; the dump is a file the player already has, at a path the game wrote it to, so the
//     honest affordance is to NAME it (`Primitive_freeport-Inventory.txt`) rather than to offer
//     to write a second copy of it somewhere else.
//   * THE UNAVAILABLE STATES ARE NAMED. A missing dump, an unreadable one and one over the
//     upload cap read completely differently to a user and each gets its own sentence
//     (`inventoryProblem`), with the `/outputfile inventory` hint on the one it can fix.
//   * IT OFFERS A RE-READ. The player can alt-tab, type the command and come back; main holds no
//     cache for this file (see `currentInventory`), so "Re-read the export" is a real button
//     rather than a lie about a cache.

import { type JSX } from 'react'
import { Button, Stack, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { count, formatBytes, PreviewLines } from './LogPreview'
import { outputAgeLabel } from '../../lib/outputFreshness'
import type { FeedbackInventoryPreview } from './useFeedback'
import { inventoryProblem } from './useFeedback'

/**
 * The state line: age first, then the file, then what it costs to send.
 * `295 rows · Primitive_freeport-Inventory.txt · 2 KB compressed`, prefixed by `updated 3d ago`.
 */
export function inventoryMetaText(dump: FeedbackInventoryPreview, now: number = Date.now()): string {
  if (dump.meta === null) return ''
  const parts = [
    outputAgeLabel(dump.meta.updatedAt, now),
    `${count(dump.meta.lines)} rows`,
    `${formatBytes(dump.meta.bytes)} compressed`
  ]
  if (dump.fileName !== null) parts.splice(2, 0, dump.fileName)
  return parts.join(' · ')
}

export interface InventoryPreviewProps {
  /** null while main is still reading it. Never null afterwards — see FeedbackInventoryPreview. */
  dump: FeedbackInventoryPreview | null
  loading: boolean
  /** Re-read the file from disk, for the player who just re-ran the command in game. */
  onRefresh: () => void
}

export default function InventoryPreview({
  dump,
  loading,
  onRefresh
}: InventoryPreviewProps): JSX.Element {
  if (loading && dump === null) {
    return (
      <Typography variant="caption" color="text.secondary">
        Reading your inventory export…
      </Typography>
    )
  }
  if (dump?.meta == null) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="feedback-inventory-empty"
        >
          {inventoryProblem(dump?.unavailable ?? 'no-dump')}
        </Typography>
        <Button
          size="small"
          startIcon={<RefreshIcon />}
          data-testid="feedback-inventory-refresh"
          onClick={onRefresh}
        >
          Re-read
        </Button>
      </Stack>
    )
  }
  return (
    <Stack spacing={0.75}>
      <Typography
        variant="caption"
        color="text.secondary"
        data-testid="feedback-inventory-meta"
        sx={{ fontFamily: 'ui-monospace, monospace' }}
      >
        {inventoryMetaText(dump)}
      </Typography>

      <PreviewLines lines={dump.previewLines} testId="feedback-inventory-preview" />

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshIcon />}
          data-testid="feedback-inventory-refresh"
          onClick={onRefresh}
        >
          Re-read the export
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>
          {dump.truncatedPreview
            ? 'This preview is shortened - the whole export is sent.'
            : 'This is the whole export.'}
        </Typography>
      </Stack>
    </Stack>
  )
}
