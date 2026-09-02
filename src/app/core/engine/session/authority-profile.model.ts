// src/app/core/engine/session/authority-profile.model.ts

export interface AuthorityProfile {
  canSelect: boolean;
  canEdit: boolean;
  canMove: boolean;
  canDelete: boolean;
  canConfigure: boolean;
  canSelectHidden: boolean;
  canSeeTriggers: boolean;
  canInteract: boolean;
  canPlay: boolean;
  canUseAdminFeatures: boolean;
  canUseGizmos: boolean;
  canViewDebug: boolean;
}

export const PROFILES: {
  ADMIN_EDITING: AuthorityProfile;
  ADMIN_PLAYING: AuthorityProfile;
  ADMIN_PREVIEW: AuthorityProfile;
  PLAYER: AuthorityProfile;
} = {
  ADMIN_EDITING: {
    canSelect: true,
    canEdit: true,
    canMove: true,
    canDelete: true,
    canConfigure: true,
    canSelectHidden: true,
    canSeeTriggers: true,
    canInteract: false,
    canPlay: false,
    canUseAdminFeatures: true,
    canUseGizmos: true,
    canViewDebug: true
  },
  ADMIN_PLAYING: {
    canSelect: true, // Permite transición a Edición In-Game durante Playtest
    canEdit: true,
    canMove: true,
    canDelete: false,
    canConfigure: true,
    canSelectHidden: true,
    canSeeTriggers: true,
    canInteract: true,
    canPlay: true,
    canUseAdminFeatures: true,
    canUseGizmos: true,
    canViewDebug: true
  },
  ADMIN_PREVIEW: {
    canSelect: false,
    canEdit: false,        // Admin Preview NO es Editor: no edita geometría en vivo
    canMove: false,
    canDelete: false,
    canConfigure: false,
    canSelectHidden: false,
    canSeeTriggers: false,
    canInteract: true,
    canPlay: true,
    canUseAdminFeatures: true, // Permite AdminFreeCamera (Ctrl+C), etc.
    canUseGizmos: false,
    canViewDebug: true
  },
  PLAYER: {
    canSelect: false,
    canEdit: false,
    canMove: false,
    canDelete: false,
    canConfigure: false,
    canSelectHidden: false,
    canSeeTriggers: false,
    canInteract: true,
    canPlay: true,
    canUseAdminFeatures: false,
    canUseGizmos: false,
    canViewDebug: false
  }
};