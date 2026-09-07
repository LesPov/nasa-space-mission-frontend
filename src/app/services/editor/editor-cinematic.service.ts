
import { Injectable, signal, computed, inject } from '@angular/core';
import { CinematicSequence, CinematicTrack, CinematicKeyframe } from '../../core/engine/models/cinematic.model';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { CinematicCameraRegistryService } from '../../core/engine/runtime/cameras/cinematic-camera-registry.service';
import { Subject } from 'rxjs';
import { Vector3 } from '@babylonjs/core';
import { CinematicLogger } from '../../core/engine/runtime/cinematics/cinematic-logger';

@Injectable({ providedIn: 'root' })
export class EditorCinematicService {
  private entityManager = inject(EntityManagerService);
  private cameraRegistry = inject(CinematicCameraRegistryService);

  public cinematics = signal<CinematicSequence[]>([]);
  public deletedCinematics: string[] = [];

  public selectedCinematicId = signal<string | null>(null);
  public selectedTrackIndex = signal<number>(-1);
  public selectedKeyframeId = signal<string | null>(null);
  public selectedReusableCameraId = signal<string | null>(null);

  public currentCinematic = computed(() => this.cinematics().find(c => c.id === this.selectedCinematicId()) || null);
  public currentTrack = computed(() => this.currentCinematic()?.tracks[this.selectedTrackIndex()] || null);
  
  public currentKeyframe = computed(() => {
     const track = this.currentTrack();
     if (!track) return null;
     const kf = track.keyframes.find(k => k.id === this.selectedKeyframeId()) || null;
     if (kf) {
         if (!kf.value) kf.value = {};
         if (track.type === 'camera' || track.type === 'actor' || track.type === 'object') {
             if (!kf.value.position) kf.value.position = {x:0, y:0, z:0};
             if (!kf.value.rotation) kf.value.rotation = {x:0, y:0, z:0};
         }
     }
     return kf;
  });

  public currentReusableCamera = computed(() => {
     const id = this.selectedReusableCameraId();
     if (!id) return null;
     return this.cameraRegistry.getCamera(id) || null;
  });

  public onProxyMoved = new Subject<{ type: 'keyframe' | 'camera', id: string, position: Vector3, rotation: Vector3 }>();

  public loadFromData(data: any[]): void {
    const clone = data ? JSON.parse(JSON.stringify(data)) : [];
    
    clone.forEach((seq: any) => {
        seq.id = seq.uid || seq.id; 
        seq.tracks = seq.tracks || [];
        
        const newTracks: any[] = [];
        let maxTimeFound = 0;

        seq.tracks.forEach((track: any) => {
            if (!track.type) track.type = 'camera'; 
            
            // 🔥 MIGRACIÓN LEGACY: Convertir clips a keyframes automáticamente para retrocompatibilidad
            if (track.clips && (!track.keyframes || track.keyframes.length === 0)) {
                CinematicLogger.logMigration('clipsToKeyframes', track.name);
                track.keyframes = [];
                track.clips.forEach((clip: any) => {
                    track.keyframes.push({
                        id: clip.id + '_start',
                        timeMs: clip.startTimeMs,
                        interpolation: clip.easing || 'linear',
                        value: { position: clip.startPosition, rotation: clip.startRotation, fov: clip.startFov }
                    });
                    track.keyframes.push({
                        id: clip.id + '_end',
                        timeMs: clip.startTimeMs + clip.durationMs,
                        interpolation: 'step', // Termina y no extrapola
                        value: { position: clip.endPosition, rotation: clip.endRotation, fov: clip.endFov }
                    });
                });
                delete track.clips;
            }
            
            track.keyframes = track.keyframes || [];
            track.keyframes.forEach((kf: any) => {
                if (!kf.value) kf.value = {};
                
                // 🔥 AUTO-HEALING: Actualizamos el tiempo máximo encontrado
                if (kf.timeMs > maxTimeFound) {
                    maxTimeFound = kf.timeMs;
                }

                if (!kf.value.targetUid && (kf.value.cameraTargetUid || track.targetUid)) {
                    kf.value.targetUid = kf.value.cameraTargetUid || track.targetUid;
                }
                if (!kf.value.cameraId && track.cameraId) {
                    kf.value.cameraId = track.cameraId;
                }
                if (!kf.value.orientationMode && track.orientationMode) {
                    kf.value.orientationMode = track.orientationMode;
                }
                if (!kf.value.movementMode) {
                    kf.value.movementMode = track.orientationMode === 'orbit' ? 'orbit' : 'linear';
                }
                if (kf.value.movementMode === 'orbit' && !kf.value.orbitDirection) {
                    kf.value.orbitDirection = 'clockwise';
                    kf.value.orbitTurns = 0; 
                }
            });

            track.keyframes.sort((a: any, b: any) => a.timeMs - b.timeMs);

            if (track.type === 'overlay') {
                const hasText = track.keyframes.some((k: any) => k.value.title || k.value.text);
                const hasImage = track.keyframes.some((k: any) => k.value.image || k.value.assetId);
                
                if (hasText && hasImage) {
                    CinematicLogger.logMigration('overlayToTextAndImage', track.name);
                    
                    const textTrack = JSON.parse(JSON.stringify(track));
                    textTrack.id = track.id + '_text';
                    textTrack.type = 'text';
                    textTrack.name = track.name + ' (Texto)';
                    
                    const imageTrack = JSON.parse(JSON.stringify(track));
                    imageTrack.id = track.id + '_image';
                    imageTrack.type = 'image';
                    imageTrack.name = track.name + ' (Imagen)';
                    
                    newTracks.push(textTrack, imageTrack);
                } else if (hasImage) {
                    CinematicLogger.logMigration('overlayToImage', track.name);
                    track.type = 'image';
                    newTracks.push(track);
                } else {
                    CinematicLogger.logMigration('overlayToText', track.name);
                    track.type = 'text';
                    newTracks.push(track);
                }
            } else {
                newTracks.push(track);
            }
        });

        seq.tracks = newTracks;

        // 🔥 AUTO-HEALING: Reparamos la duración si la DB viene desfasada
        if (!seq.durationMs || seq.durationMs < maxTimeFound) {
            CinematicLogger.warn(`Auto-sanitizando duración de cinemática '${seq.name}'. Ajustada a ${maxTimeFound}ms para evitar bloqueos.`);
            seq.durationMs = maxTimeFound;
        }
    });
    
    this.cinematics.set(clone);
    this.deletedCinematics = [];
  }

  public eliminarCinematica(id: string): void {
    this.deletedCinematics.push(id);
    this.cinematics.update(v => v.filter(c => c.id !== id));
    this.selectedCinematicId.set(this.cinematics().length > 0 ? this.cinematics()[0].id : null);
    this.selectedTrackIndex.set(-1);
    this.selectedKeyframeId.set(null);
  }

  public quitarTrack(cin: CinematicSequence, index: number): void {
    cin.tracks.splice(index, 1);
    this.selectedTrackIndex.set(-1);
    this.selectedKeyframeId.set(null);
  }

  public quitarKeyframe(track: CinematicTrack, id: string): void {
    track.keyframes = track.keyframes.filter(k => k.id !== id);
    this.selectedKeyframeId.set(null);
  }

  public validateCinematic(cinematic: CinematicSequence): string[] {
    const errors: string[] = [];
    
    if (!cinematic.durationMs || cinematic.durationMs <= 0) {
      errors.push('La duración de la cinemática debe ser mayor a 0ms.');
    }

    cinematic.tracks.forEach((track) => {
      if ((track.type === 'actor' || track.type === 'object') && !track.targetUid && !track.keyframes.some(k => k.value.targetUid)) {
        errors.push(`Pista '${track.name}' (${track.type}) no tiene un objetivo asignado.`);
      }
      
      const sortedKfs = [...track.keyframes].sort((a, b) => a.timeMs - b.timeMs);
      
      for (let i = 0; i < sortedKfs.length; i++) {
        const kf = sortedKfs[i];
        
        if (kf.value?.useLocalSpaceUid && !this.entityManager.getEntityByUid(kf.value.useLocalSpaceUid)) {
             errors.push(`Advertencia: Actor de anclaje relativo perdido en pista '${track.name}'.`);
        }
        
        const target = kf.value?.targetUid || kf.value?.cameraTargetUid || track.targetUid;
        if (target && !this.entityManager.getEntityByUid(target)) {
             errors.push(`Advertencia: El objetivo a mirar (Target) asignado en '${track.name}' ya no existe en el mapa.`);
        }

        if (kf.timeMs > cinematic.durationMs) {
           errors.push(`El Keyframe en la pista '${track.name}' excede la duración total de la cinemática.`);
        }
        if (kf.timeMs < 0) {
           errors.push(`El Keyframe en la pista '${track.name}' tiene un tiempo negativo.`);
        }

        if (kf.value?.fov !== undefined) {
           if (kf.value.fov < 0.1 || kf.value.fov > Math.PI) {
               errors.push(`FOV inválido en pista '${track.name}'. Rango válido: 0.1 a 3.14 radianes.`);
               CinematicLogger.warn(`Invalid FOV: ${kf.value.fov}`);
           }
        }
        
        if (kf.value?.movementMode === 'orbit') {
            if (!target) {
               errors.push(`Advertencia crítica en pista '${track.name}': Se requiere un Target válido para utilizar el Modo Órbita (Orbit).`);
            }
        }
      }
    });

    return errors;
  }
}