import { createContext, useContext } from 'react';

import type { Experience, ExperienceOrUnselected } from './experience';

// PROGRAM 2 LOOP 9: the experience context lives in its own module so both
// experience shells can read it without importing ExperienceRouter (which
// imports the shells — that would be a cycle). Holds NO token.

export interface ExperienceValue {
  experience: ExperienceOrUnselected;
  /** True while a shell swap is in flight (LOOP 10B re-entrancy guard) — callers should disable a "Switch to …" affordance while true. */
  switching: boolean;
  /** Persist the choice and mount that shell. A no-op while already switching or already on `target`. */
  switchExperience: (target: Experience) => void;
  /** Return to the chooser. */
  openSelector: () => void;
}

export const ExperienceContext = createContext<ExperienceValue | null>(null);

export function useExperience(): ExperienceValue {
  const value = useContext(ExperienceContext);
  if (!value) throw new Error('useExperience must be used within the ExperienceRouter');
  return value;
}
