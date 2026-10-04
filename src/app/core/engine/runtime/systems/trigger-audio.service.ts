
// file: src/app/core/engine/runtime/systems/trigger-audio.service.ts
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { AbstractMesh, Vector3 } from '@babylonjs/core';
import { SpatialRelevanceHubService } from '../../spatial/spatial-relevance-hub.service';

export interface AudioPlaybackState {
  audio: HTMLAudioElement;
  entity: GameEntity;
  targetVol: number;
  maxDist: number;
  fadeInSecs: number;
  elapsedSecs: number;
  isSpatial: boolean;
  isProximity: boolean;
  eventType: string;
  state: 'playing' | 'fading_in' | 'fading_out' | 'paused' | 'stopped';
}

@Injectable({ providedIn: 'root' })
export class TriggerAudioService implements IUpdatable {
  public id = 'TriggerAudioSystem';
  private context = inject(GameContextService);
  private entityManager = inject(EntityManagerService);
  private spatialHub = inject(SpatialRelevanceHubService);
  
  private activeAudios = new Map<string, AudioPlaybackState>();
  private _tempClosestPoint = Vector3.Zero();

  public start(): void {
      this.stopAll();
  }

  public stop(): void {
      this.stopAll();
  }

  private stopAll(): void {
      this.activeAudios.forEach(data => {
          data.audio.pause();
          data.audio.currentTime = 0;
      });
      this.activeAudios.clear();
  }

  public playTriggerEvent(entity: GameEntity, eventType: string): void {
      let soundUrl = '';
      let loop = false;
      let targetVol = 0.8;
      let maxDist = 50;
      let fadeIn = 1.0;
      let isSpatial = true;

      if (entity.trigger!.isComposite) {
          if (eventType === 'on_enter') {
              soundUrl = entity.trigger!.soundUrlEntrada;
              loop = entity.trigger!.audioLoopEntrada;
              targetVol = entity.trigger!.audioVolumeEntrada;
              maxDist = entity.trigger!.audioMaxDistEntrada;
              fadeIn = entity.trigger!.audioFadeInEntrada;
              isSpatial = entity.trigger!.audioSpatialEntrada;
          } else if (eventType === 'on_exit') {
              soundUrl = entity.trigger!.soundUrlSalida;
              loop = entity.trigger!.audioLoopSalida;
              targetVol = entity.trigger!.audioVolumeSalida;
              maxDist = entity.trigger!.audioMaxDistSalida;
              fadeIn = entity.trigger!.audioFadeInSalida;
              isSpatial = entity.trigger!.audioSpatialSalida;
          }
      } else {
          soundUrl = entity.trigger!.soundUrl;
          loop = entity.trigger!.audioLoopNorm;
          targetVol = entity.trigger!.audioVolumeNorm;
          maxDist = entity.trigger!.audioMaxDistNorm;
          fadeIn = entity.trigger!.audioFadeInNorm;
          isSpatial = entity.trigger!.audioSpatialNorm;
      }

      if (soundUrl && soundUrl.trim() !== '') {
          this.startAudio(entity, eventType, soundUrl, loop, targetVol, maxDist, fadeIn, isSpatial, false);
      }
  }

  private startAudio(
      entity: GameEntity, eventType: string, url: string, loop: boolean, 
      targetVol: number, maxDist: number, fadeIn: number, 
      isSpatial: boolean, isProximity: boolean
  ): void {
      const audioKey = `${entity.uid}_${eventType}`;
      let audioData = this.activeAudios.get(audioKey);
      
      if (!audioData) {
          const audio = new Audio(url);
          audio.loop = loop;
          audioData = { 
              audio, entity, targetVol, maxDist, fadeInSecs: fadeIn, 
              elapsedSecs: 0, isSpatial, isProximity, eventType, state: 'fading_in'
          };
          this.activeAudios.set(audioKey, audioData);
      } else {
          audioData.audio.loop = loop;
          audioData.targetVol = targetVol;
          audioData.maxDist = maxDist;
          audioData.fadeInSecs = fadeIn;
          audioData.isSpatial = isSpatial;
          audioData.isProximity = isProximity;
          
          if (audioData.state === 'paused' || audioData.state === 'stopped') {
              audioData.elapsedSecs = 0;
              audioData.state = 'fading_in';
          }
      }
      
      if (audioData.audio.paused) {
          audioData.audio.volume = 0;
          if (!loop) audioData.audio.currentTime = 0;
          audioData.audio.play().catch(err => {
              console.warn(`[TriggerAudioService] ⚠️ Bloqueo de reproducción por falta de interacción:`, err);
          });
      }
  }

  public update(dtMs: number): void {
      const playerEntity = this.context.activePlayerEntity();
      if (!playerEntity || !playerEntity.view) return;
      const playerPos = playerEntity.view.getAbsolutePosition();

      this.checkProximityTriggers(playerPos);
      this.updateActiveAudios(dtMs, playerPos);
  }

  private checkProximityTriggers(playerPos: Vector3): void {
      const entities = this.entityManager.getAllEntities();
      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          if (e.type !== 'trigger' && e.type !== 'trigger_compuesto') continue;
          if (!e.trigger || e.triggerRuntime?.isEnabled === false) continue;

          const mesh = e.view as AbstractMesh;
          if (!mesh) continue;

          // 🔥 PREFILTRO SPATIAL HUB: si la distancia cuadrática al actor excede el rango máximo más radio, omitir
          const rec = this.spatialHub.getRecord(e.uid);
          const radius = rec ? rec.boundingRadius : 2.0;

          if (!e.trigger.isComposite && e.trigger.audioProximityNorm && e.trigger.soundUrl) {
              const maxD = (e.trigger.audioMaxDistNorm || 50) + radius;
              if (this.spatialHub.getDistanceSquaredToPlayer(e.uid) <= maxD * maxD) {
                this.evaluateProximity(e, 'norm', playerPos, mesh, e.trigger.soundUrl, e.trigger.audioLoopNorm, e.trigger.audioVolumeNorm, e.trigger.audioMaxDistNorm, e.trigger.audioFadeInNorm, e.trigger.audioSpatialNorm);
              }
          }
          
          if (e.trigger.isComposite && e.trigger.audioProximityEntrada && e.trigger.soundUrlEntrada) {
              const maxD = (e.trigger.audioMaxDistEntrada || 50) + radius;
              if (this.spatialHub.getDistanceSquaredToPlayer(e.uid) <= maxD * maxD) {
                this.evaluateProximity(e, 'on_enter', playerPos, mesh, e.trigger.soundUrlEntrada, e.trigger.audioLoopEntrada, e.trigger.audioVolumeEntrada, e.trigger.audioMaxDistEntrada, e.trigger.audioFadeInEntrada, e.trigger.audioSpatialEntrada);
              }
          }

          if (e.trigger.isComposite && e.trigger.audioProximitySalida && e.trigger.soundUrlSalida) {
              const maxD = (e.trigger.audioMaxDistSalida || 50) + radius;
              if (this.spatialHub.getDistanceSquaredToPlayer(e.uid) <= maxD * maxD) {
                this.evaluateProximity(e, 'on_exit', playerPos, mesh, e.trigger.soundUrlSalida, e.trigger.audioLoopSalida, e.trigger.audioVolumeSalida, e.trigger.audioMaxDistSalida, e.trigger.audioFadeInSalida, e.trigger.audioSpatialSalida);
              }
          }
      }
  }

  private evaluateProximity(
      entity: GameEntity, eventType: string, playerPos: Vector3, mesh: AbstractMesh, 
      url: string, loop: boolean, targetVol: number, maxDist: number, 
      fadeIn: number, isSpatial: boolean
  ): void {
      const dist = this.getDistanceToMesh(mesh, playerPos);
      const audioKey = `${entity.uid}_${eventType}`;
      const active = this.activeAudios.get(audioKey);

      if (dist <= maxDist) {
          if (!active || active.state === 'paused' || active.state === 'stopped') {
              this.startAudio(entity, eventType, url, loop, targetVol, maxDist, fadeIn, isSpatial, true);
          }
      } else {
          if (active && active.isProximity && (active.state === 'playing' || active.state === 'fading_in')) {
              active.state = 'fading_out';
              active.elapsedSecs = 0; 
          }
      }
  }

  private updateActiveAudios(dtMs: number, playerPos: Vector3): void {
      if (this.activeAudios.size === 0) return;

      this.activeAudios.forEach((audioData, key) => {
          if (audioData.audio.ended && !audioData.audio.loop) {
              this.activeAudios.delete(key);
              return;
          }

          const mesh = audioData.entity.view as AbstractMesh;
          if (!mesh || audioData.audio.paused) return;

          audioData.elapsedSecs += (dtMs / 1000);
          let fadeFactor = 1.0;

          if (audioData.state === 'fading_in') {
              if (audioData.fadeInSecs > 0) {
                  let p = Math.min(1.0, audioData.elapsedSecs / audioData.fadeInSecs);
                  fadeFactor = p * p;
                  if (p >= 1.0) audioData.state = 'playing';
              } else {
                  audioData.state = 'playing';
              }
          } else if (audioData.state === 'fading_out') {
              const fadeOutDuration = 1.0; 
              let p = Math.max(0.0, 1.0 - (audioData.elapsedSecs / fadeOutDuration));
              fadeFactor = p * p;
              if (p <= 0.0) {
                  audioData.audio.volume = 0;
                  audioData.audio.pause();
                  audioData.state = 'stopped';
                  if (audioData.isProximity) {
                      this.activeAudios.delete(key);
                  }
                  return;
              }
          }

          if (!audioData.isSpatial) {
              audioData.audio.volume = Math.max(0, Math.min(1, audioData.targetVol * fadeFactor));
              return;
          }

          const dist = this.getDistanceToMesh(mesh, playerPos);
          
          if (dist >= audioData.maxDist) {
              if (audioData.state !== 'fading_out') {
                 audioData.state = 'fading_out';
                 audioData.elapsedSecs = 0; 
              }
          } else {
              if (audioData.state === 'fading_out' && audioData.isProximity) {
                  audioData.state = 'fading_in';
                  audioData.elapsedSecs = 0;
              }

              let distFactor = Math.max(0, 1.0 - (dist / audioData.maxDist));
              distFactor = distFactor * distFactor; 

              audioData.audio.volume = Math.max(0, Math.min(1, audioData.targetVol * distFactor * fadeFactor));
          }
      });
  }

  private getDistanceToMesh(mesh: AbstractMesh, playerPos: Vector3): number {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      
      const clampX = Math.max(bounds.minimumWorld.x, Math.min(bounds.maximumWorld.x, playerPos.x));
      const clampY = Math.max(bounds.minimumWorld.y, Math.min(bounds.maximumWorld.y, playerPos.y));
      const clampZ = Math.max(bounds.minimumWorld.z, Math.min(bounds.maximumWorld.z, playerPos.z));
      
      this._tempClosestPoint.set(clampX, clampY, clampZ);
      return Vector3.Distance(playerPos, this._tempClosestPoint);
  }
}