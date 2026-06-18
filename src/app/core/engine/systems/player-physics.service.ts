

import { Injectable } from '@angular/core';
import { Vector3 } from '@babylonjs/core';

export interface EstadoFisico {
  isMoving: boolean;
  isRunning: boolean;
  isGrounded: boolean;
  isJumping: boolean;
  isFalling: boolean;
  isHardLanding: boolean;
  isRecoveringFromFall: boolean;
  landingFrame: number;
  recoveryFrame: number;
  velocidadY: number;
  highestY: number; 
}

@Injectable({ providedIn: 'root' })
export class PlayerPhysicsService {
  // Servicio puramente stateless. La lógica pesada de gravedad y raycasts
  // ha sido trasladada a los controladores dedicados (Ej: PlayerController).
  
  public sanitizeForwardDir(dir: Vector3): Vector3 {
    const d = dir.clone();
    d.y = 0;
    if (d.lengthSquared() < 0.0001) return new Vector3(0, 0, 1);
    return d.normalize();
  }
}