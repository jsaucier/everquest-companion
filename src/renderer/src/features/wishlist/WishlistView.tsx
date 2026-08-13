// WishlistView — the honest placeholder (JOS-324; the real thing is JOS-326).
//
// The gear area ships with four tabs the day the nav rows collapse, and one of them has no feature
// behind it yet. The alternative shapes were both worse: hiding the tab until JOS-326 would mean
// shipping the collapse twice and re-teaching the bar's shape a week later, and drawing an empty
// table would be a lie about a surface that does not exist.
//
// So it says so. The voice is `NoLogsEmptyState`'s — quiet, centred, secondary text, and it names
// what the thing WILL be rather than apologising for what it is not. No spinner (nothing is
// loading), no button (there is nowhere to send anyone), no date.
//
// It takes no props and reads nothing. JOS-326 replaces this file's body; the tab, the view id and
// the testid below are already what that ticket lands into.

import type { JSX } from 'react'
import { Box, Typography } from '@mui/material'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'

export default function WishlistView(): JSX.Element {
  return (
    <Box
      data-testid="wishlist-view"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 1.5,
        color: 'text.secondary'
      }}
    >
      <FavoriteBorderIcon sx={{ fontSize: 48, opacity: 0.6 }} />
      <Typography variant="h6" color="text.primary">
        Your wish list is arriving with the next update
      </Typography>
      <Typography variant="body2" sx={{ maxWidth: 440 }} data-testid="wishlist-placeholder">
        This is where the items you have decided you want will live - kept as a list you write
        yourself, beside the Gear table that finds them and the Exaltations board that plans them
        in. Nothing to do here yet.
      </Typography>
    </Box>
  )
}
