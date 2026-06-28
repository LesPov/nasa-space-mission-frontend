
import { CameraOwner } from '../cameras/camera-ownership.service';

export type MovementProfileType = 'EDITOR_FREE' | 'PLAYER_PHYSICAL';

export interface MovementProfile {
  type: MovementProfileType;
  physicsEnabled: boolean;
  gravityEnabled: boolean;
  collisionsEnabled: boolean;
  jumpEnabled: boolean;
  customInputEnabled: boolean;
}

export const MOVEMENT_PROFILES: Record<MovementProfileType, MovementProfile> = {
  'EDITOR_FREE': {
    type: 'EDITOR_FREE',
    physicsEnabled: false,
    gravityEnabled: false,
    collisionsEnabled: false,
    jumpEnabled: false,
    customInputEnabled: false
  },
  'PLAYER_PHYSICAL': {
    type: 'PLAYER_PHYSICAL',
    physicsEnabled: true,
    gravityEnabled: true,
    collisionsEnabled: true,
    jumpEnabled: true,
    customInputEnabled: true
  }
};

export function getMovementProfileForOwner(owner: CameraOwner): MovementProfile {
  if (owner === 'PLAYER_FPS' || owner === 'PLAYER_TPS') {
    return MOVEMENT_PROFILES['PLAYER_PHYSICAL'];
  }
  return MOVEMENT_PROFILES['EDITOR_FREE'];
}
