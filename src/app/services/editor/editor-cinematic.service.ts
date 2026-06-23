
import { Injectable, signal, inject } from '@angular/core';
import { CinematicSequence } from '../../core/engine/models/cinematic.model';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { Subject } from 'rxjs';
import { Vector3 } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class EditorCinematicService {
  private entityManager = inject(EntityManagerService);

  public cinematics = signal<CinematicSequence[]>([]);
  public deletedCinematics: string[] = [];

  // 🔥 Evento para sincronizar Gizmos con el Timeline de forma limpia
  public onProxyMoved = new Subject<{ clipId: string, position: Vector3, rotation: Vector3 }>();

  public loadFromData(data: CinematicSequence[]): void {
    if (data) {
        data.forEach(seq => {
            seq.tracks.forEach(track => {
                track.clips.forEach(clip => {
                    if (!clip.startPosition) clip.startPosition = {x:0, y:0, z:0};
                    if (!clip.endPosition) clip.endPosition = {x:0, y:0, z:0};
                    if (!clip.startRotation) clip.startRotation = {x:0, y:0, z:0};
                    if (!clip.endRotation) clip.endRotation = {x:0, y:0, z:0};
                });
            });
        });
    }
    this.cinematics.set(data || []);
    this.deletedCinematics = [];
  }

  public validateCinematic(cinematic: CinematicSequence): string[] {
    const errors: string[] = [];
    
    if (cinematic.durationMs <= 0) {
      errors.push('La duración de la cinemática debe ser mayor a 0ms.');
    }

    cinematic.tracks.forEach((track, tIdx) => {
      if (track.type === 'actor' && !track.targetUid) {
        errors.push(`Pista '${track.name}' (Actor) no tiene un objetivo asignado.`);
      }

      const sortedClips = [...track.clips].sort((a, b) => a.startTimeMs - b.startTimeMs);
      
      for (let i = 0; i < sortedClips.length; i++) {
        const clip = sortedClips[i];
        
        if (clip.useLocalSpaceUid && !this.entityManager.getEntityByUid(clip.useLocalSpaceUid)) {
             errors.push(`Actor o anclaje relativo perdido en pista '${track.name}'.`);
        }
        if (clip.cameraTargetUid && !this.entityManager.getEntityByUid(clip.cameraTargetUid)) {
             errors.push(`El objetivo a mirar de la pista '${track.name}' ya no existe en el mapa.`);
        }

        if (clip.startTimeMs + clip.durationMs > cinematic.durationMs) {
           errors.push(`El clip en la pista '${track.name}' excede la duración total de la cinemática.`);
        }
        if (i < sortedClips.length - 1) {
          const nextClip = sortedClips[i+1];
          if (clip.startTimeMs + clip.durationMs > nextClip.startTimeMs) {
            errors.push(`Solape de tiempo detectado en la pista '${track.name}' entre clips.`);
          }
        }
      }
    });

    return errors;
  }
}