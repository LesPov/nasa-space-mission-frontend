
export interface AuthorityProfile {
  canEdit: boolean;
  canSelectHidden: boolean;
  canUseGizmos: boolean;
  canViewDebug: boolean;
  canFly: boolean;
  canSeeTriggers: boolean;
}

export const PROFILES = {
  ADMIN_EDITING: {
    canEdit: true,
    canSelectHidden: true,
    canUseGizmos: true,
    canViewDebug: true,
    canFly: true,
    canSeeTriggers: true
  } as AuthorityProfile,
  ADMIN_PLAYING: {
    canEdit: false,
    canSelectHidden: true,
    canUseGizmos: false,
    canViewDebug: true,
    canFly: true,
    canSeeTriggers: true
  } as AuthorityProfile,
  PLAYER: {
    canEdit: false,
    canSelectHidden: false,
    canUseGizmos: false,
    canViewDebug: false,
    canFly: false,
    canSeeTriggers: false
  } as AuthorityProfile
};