
import { Injectable } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';

@Injectable({ providedIn: 'root' })
export class CullingService implements IUpdatable {
  public id = 'CullingService';
  
  // 🔥 ESTE SERVICIO QUEDA NEUTRALIZADO.
  // Toda la lógica de Culling Espacial, Visibilidad Progresiva, Opacidad (Fade),
  // Batch Notification para la interfaz Angular y Hard Culling
  // ha sido completamente transferida a "LocalRenderingSystem" 
  // que ahora opera como Single Source of Truth para el rendimiento.

  public start(): void {}
  public stop(): void {}
  public update(dtMs: number): void {}
}