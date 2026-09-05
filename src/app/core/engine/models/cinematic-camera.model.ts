
import { Vector3State } from './cinematic.model';

export interface CinematicCameraDefinition {
  id: string;
  name: string;
  position: Vector3State;
  rotation: Vector3State;
  fov?: number;
  cameraTargetUid?: string;
}