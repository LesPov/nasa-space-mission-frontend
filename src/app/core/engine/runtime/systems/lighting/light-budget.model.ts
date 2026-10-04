
export const LIGHT_BUDGET_CONSTANTS = {
  /** Máximo absoluto de luces físicas locales activas simultáneamente en el pool */
  MAX_ACTIVE_LOCAL_LIGHTS: 3,

  /** Radio centralizado de relevancia: dentro de este radio las luces compiten por los 3 slots */
  LIGHT_RELEVANCE_RADIUS: 30.0,

  /** Radio exterior de histéresis: superado este límite la luz libera su slot definitivamente */
  LIGHT_RELEASE_RADIUS: 34.0,

  /** Umbral mínimo de retención de slot para mitigar churn en cambios de dirección rápidos */
  MIN_SLOT_HOLD_TIME_MS: 300,

  /** Bonificación de score para luces que ya poseen un slot activo */
  SLOT_STICKINESS_BONUS: 0.15,

  /** Umbral numérico de apagado absoluto de intensidad */
  INTENSITY_CUTOFF: 0.0001
};

export type LightRejectionReason = 
  | 'NONE'
  | 'DISABLED'
  | 'OUTSIDE_RELEVANCE_RADIUS'
  | 'LOWER_SCORE'
  | 'CONTAINMENT_MISMATCH'
  | 'NO_FREE_SLOTS';

export interface LightBudgetSlotDetail {
  slotIndex: number;
  assignedEntityUid: string | null;
  assignedEntityName: string;
  type: string;
  distance: number;
  score: number;
  activeTimeMs: number;
  state: 'UNASSIGNED' | 'PREACTIVATING' | 'OCCUPIED' | 'RELEASING';
  reassignmentCount: number;
}

export interface CandidateLightSummary {
  uid: string;
  name: string;
  distance: number;
  score: number;
  rank: number;
  assignedSlot: number | null;
  isInterior: boolean;
  rejectionReason: LightRejectionReason;
}

export interface LightBudgetMetrics {
  totalVirtualLights: number;
  candidatesCount: number;
  activePhysicalLights: number;
  maxPhysicalLights: number;
  relevanceRadius: number;
  releaseRadius: number;
  slotChangesTotal: number;
  slotChangesPerSecond: number;
  slots: LightBudgetSlotDetail[];
  candidates: CandidateLightSummary[];
  rejected: CandidateLightSummary[];
}