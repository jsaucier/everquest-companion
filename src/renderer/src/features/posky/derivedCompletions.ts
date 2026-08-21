// derivedCompletions.ts — WHICH QUESTS SOMETHING OTHER THAN THE LEDGER VOUCHES FOR (JOS-429).
//
// One subject, and it became one the moment there were two such sources: the ledger
// (shared/questTurnIns.ts) knows log-detected trades, hand statements and the legacy key, and
// everything here is the OTHER kind of knowledge — a completion nobody recorded that something else
// nonetheless proves.
//
// SPLIT OUT OF `useProgress.ts` because that hook was at its measured factoring ceiling, the same
// cut `useHeldItems` and `useTurnInLedger` already made inside it. Nothing moved but the two memos
// and the list they build.
//
// THE ORDER OF THE LIST DECIDES NOTHING. `derivedCompletion` ranks by NAME
// (`DERIVED_EVIDENCE_RANK`), precisely so the answer cannot depend on the order a hook happened to
// assemble its sources in; the array below is written strongest-first only because that is how it
// reads. `questCompletion.ts withDerivedCompletion` is what applies it to a row.

import { useMemo } from 'react'
import type { PoskyQuest, ProgressState } from '@shared/types'
import { achievementVouchedQuests } from './achievementInference'
import { rewardInferredQuests } from './rewardInference'
import { withDerivedCompletion } from './questCompletion'
import type { QuestProgress } from './useProgress'

/**
 * The derived floor, resolved against the loaded exports and handed back READY TO APPLY.
 *
 * It returns the transform rather than the sources because the caller has exactly one thing to do
 * with them, and because the sources are then unable to reach anywhere else — the ladder is
 * consulted in one place. `questCompletion.ts withDerivedCompletion` is the rule itself and stays
 * pure and directly testable; this is only the wiring that feeds it.
 *
 * BOTH SOURCES ARE DERIVED ON EVERY READ AND NEITHER IS PERSISTED AS A TURN-IN. The store holds
 * what the FILES said (`inventory`, `achievementUnlocks`); the completion each implies is worked
 * out here, every time, so a reading can never go stale in a store and a corrected export corrects
 * the tab on the next push.
 *
 * The reward inference reads the RAW dump counts rather than the reconciled `net`, because it is
 * about what the export SAW, whatever count source the user picked for the farming numbers.
 */
export function useDerivedCompletions(
  quests: readonly PoskyQuest[],
  progress: ProgressState | null
): (q: QuestProgress) => QuestProgress {
  const inventory = progress?.inventory
  const unlocks = progress?.achievementUnlocks
  // The reward in your inventory export (issue #27) — sound, and gated hard, but still a
  // conclusion drawn from a bag rather than an answer the game gave.
  const reward = useMemo(() => rewardInferredQuests(quests, inventory), [quests, inventory])
  // The SERVER'S OWN answer out of `/outputfile achievements` (JOS-429), which is why it outranks
  // the one above wherever both speak.
  const achievement = useMemo(() => achievementVouchedQuests(quests, unlocks), [quests, unlocks])
  return useMemo(
    () => (q: QuestProgress) =>
      withDerivedCompletion(q, [
        { evidence: 'achievement', vouched: achievement },
        { evidence: 'reward', vouched: reward }
      ]),
    [achievement, reward]
  )
}
