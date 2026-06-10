
import { Injectable, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
import { Motor3dService } from '../motor-3d.service';
import {
  Mesh,
  Vector3,
  Quaternion,
  AnimationGroup,
  Observer,
  KeyboardInfo,
  Scene,
  KeyboardEventTypes,
  MeshBuilder,
  Matrix,
  Ray,
  UniversalCamera,
  AbstractMesh,
  TransformNode
} from '@babylonjs/core';
import {
  cloneDefaultPlayerConfig,
  mergePlayerConfig,
  normalizeAnimBinding,
  PlayerRuntimeConfig,
  PlayerActionKey,
  PlayerClipSequence,
  PlayerSequenceStep
} from './player-config.model';

@Injectable({ providedIn: 'root' })
export class EditorPlayerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private cameraSvc = inject(EditorCameraService);

  private debugPlayer = true;

  private playerHalfHeight = 0.9;
  private playerEyeLevel = 1.6;
  private playerRadius = 0.4;

  private headNode: TransformNode | null = null;
  private initialHeadLocal: Vector3 | null = null;

  private currentEyeLevel = 1.6;
  private currentPivotY = 1.5;
  private idleTime = 0;

  private velocidadY = 0;
  private gravedad = 0.018;
  private jumpForce = 0.16;
  private highestY = -9999;

  private isJumping = false;
  private isFalling = false;
  private isHardLanding = false;

  private isClimbing = false;
  private isPullingUp = false;
  private isRecoveringFromFall = false;
  private justFinishedClimb = false;

  private climbFrame = 0;
  private pullUpFrame = 0;
  private landingFrame = 0;
  private recoveryFrame = 0;

  private climbStartY = 0;
  private climbTargetY = 0;

  private climbHangPos: Vector3 = Vector3.Zero();
  private climbUpEndPos: Vector3 = Vector3.Zero();
  private climbTopPos: Vector3 = Vector3.Zero();
  private climbForwardDir: Vector3 = Vector3.Zero();

  private climbLedgeMesh: AbstractMesh | null = null;
  private climbLedgeTopY = 0;

  private postClimbLockFramesRemaining = 0;

  private walkSpeed = 0.045;
  private runSpeed = 0.09;

  private climbDuration = 50;
  private pullUpDuration = 32;

  private climbForwardMultiplier = 0.12;
  private climbUpForwardMultiplier = 0.05;

  private animacionesJugador: AnimationGroup[] = [];
  private animActual: AnimationGroup | null = null;

  private animIdle: AnimationGroup | null = null;
  private animWalk: AnimationGroup | null = null;
  private animRun: AnimationGroup | null = null;
  private animJump: AnimationGroup | null = null;
  private animJumpLoop: AnimationGroup | null = null;
  private animFall: AnimationGroup | null = null;
  private animLandSoft: AnimationGroup | null = null;
  private animHardLanding: AnimationGroup | null = null;
  private animClimb: AnimationGroup | null = null;
  private animClimbFinish: AnimationGroup | null = null;
  private animHangIdle: AnimationGroup | null = null;
  private animVault: AnimationGroup | null = null;
  private animStepUp: AnimationGroup | null = null;
  private animRecover: AnimationGroup | null = null;

  private playerConfig: PlayerRuntimeConfig = cloneDefaultPlayerConfig();

  private inputMap: Record<string, boolean> = {};
  private tecladoObserver: Observer<KeyboardInfo> | null = null;
  private tpsUpdateObserver: Observer<Scene> | null = null;
  
  private previewObserver: Observer<Scene> | null = null;

  private activeSequenceId: string | null = null;
  private activeSequenceIndex = 0;
  private activeSequenceElapsedMs = 0;
  private activeSequenceStepEntered = false;
  private activeSequenceWasRunning = false;
  private sequenceJumpTriggered = false;

  private eKeyPressed = false;
  private iKeyPressed = false;

  constructor() {
    document.addEventListener('pointerlockchange', () => {
      const isLocked = !!document.pointerLockElement;
      this.state.ratonBloqueado.set(isLocked);

      if (!isLocked) {
        const stateStr = this.state.playState();
        if (
          stateStr === 'PLAYING' ||
          stateStr === 'EDITING_IN_GAME' ||
          stateStr === 'TRANSITIONING' ||
          stateStr === 'INTERACTING'
        ) {
          this.log('Pointer lock perdido -> reset');
          this.resetMovimientoJugador();
        }
      }
    });
  }

  private log(message: string, data?: any) {
    if (!this.debugPlayer) return;
    if (data !== undefined) console.log(`[EditorPlayer] ${message}`, data);
    else console.log(`[EditorPlayer] ${message}`);
  }

  private sanitizeForwardDir(dir: Vector3): Vector3 {
    const d = dir.clone();
    d.y = 0;
    if (d.lengthSquared() < 0.0001) return new Vector3(0, 0, 1);
    return d.normalize();
  }

  private abrirMensajeInteractivo(obj: AbstractMesh): void {
    this.state.playState.set('INTERACTING');
    this.state.objetoInteractuado.set(obj);
    this.state.objetoSeleccionado.set(obj);
    this.state.objetoHovereado.set(null);
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.ratonBloqueado.set(false);

    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch {}

    this.resetMovimientoJugador();
  }

  private clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
  }

  private easeInOutSmooth(t: number): number {
    const x = this.clamp01(t);
    return x * x * (3 - 2 * x);
  }

  private easeOutCubic(t: number): number {
    const x = this.clamp01(t);
    return 1 - Math.pow(1 - x, 3);
  }

  private getWorldTopY(mesh: AbstractMesh | null, fallbackY: number): number {
    if (!mesh) return fallbackY;
    try {
      mesh.computeWorldMatrix(true);
      const bi = mesh.getBoundingInfo?.();
      if (bi && bi.boundingBox) {
        const topY = bi.boundingBox.maximumWorld.y;
        if (Number.isFinite(topY)) return topY;
      }
    } catch {}
    return fallbackY;
  }

  private getScaleFactor(): number {
    return this.playerHalfHeight / 0.9;
  }

  private getClimbStandingY(topY: number): number {
    const s = this.getScaleFactor();
    return topY + (this.playerConfig.climb.topOffsetY * s);
  }

  private getSafeGrabStartPos(chestPoint: Vector3, forwardDir: Vector3, currentY: number): Vector3 {
    const grab = chestPoint.clone();
    grab.subtractInPlace(forwardDir.scale(this.playerRadius * 0.82));
    grab.y = currentY - (this.playerHalfHeight * 0.25);
    return grab;
  }

  private getClimbVisualY(ledgeTopY: number, currentY: number, isModel: boolean): { hangY: number; upY: number; topY: number } {
    const s = this.getScaleFactor();
    const hangY = ledgeTopY - (this.playerConfig.climb.hangOffsetY * s);
    const upY = hangY + (this.playerConfig.climb.upOffsetY * s);
    const topFromLedge = ledgeTopY + (this.playerConfig.climb.topOffsetY * s);
    const topFromUp = upY + (this.playerHalfHeight * (isModel ? 0.12 : 0.10));
    const topY = Math.max(topFromLedge, topFromUp);
    return { hangY, upY, topY };
  }

  private resolveAnimation(binding: string | string[] | null, fallback: AnimationGroup | null): AnimationGroup | null {
    const names = normalizeAnimBinding(binding).map(v => v.toLowerCase());
    if (names.length === 0) return fallback;

    const exact = this.animacionesJugador.find(ag => names.some(n => ag.name.toLowerCase() === n));
    if (exact) return exact;

    const contains = this.animacionesJugador.find(ag => names.some(n => ag.name.toLowerCase().includes(n)));
    if (contains) return contains;

    return fallback;
  }

  private isActionEnabled(action: PlayerActionKey): boolean {
    return this.playerConfig.animationEnabled?.[action] !== false;
  }

  private getAnimationForAction(action: PlayerActionKey): AnimationGroup | null {
    switch (action) {
      case 'idle': return this.animIdle;
      case 'walk': return this.animWalk || this.animIdle;
      case 'run': return this.animRun || this.animWalk || this.animIdle;
      case 'jumpStart': return this.animJump || this.animJumpLoop || this.animIdle;
      case 'jumpLoop': return this.animJumpLoop || this.animJump || this.animIdle;
      case 'fall': return this.animFall || this.animJumpLoop || this.animJump || this.animIdle;
      case 'landSoft': return this.animLandSoft || this.animIdle;
      case 'landHard': return this.animHardLanding || this.animLandSoft || this.animIdle;
      case 'climbUp': return this.animClimb || this.animIdle;
      case 'climbFinish': return this.animClimbFinish || this.animClimb || this.animIdle;
      case 'hangIdle': return this.animHangIdle || this.animClimb || this.animIdle;
      case 'vault': return this.animVault || this.animJump || this.animIdle;
      case 'stepUp': return this.animStepUp || this.animClimbFinish || this.animIdle;
      case 'recover': return this.animRecover || this.animIdle;
      default: return this.animIdle;
    }
  }

  private getSequenceList(): PlayerClipSequence[] {
    const seqs = this.playerConfig.sequences || [];
    return seqs.filter(s => !!s.enabled);
  }

  private getSelectedSequence(): PlayerClipSequence | null {
    const seqs = this.getSequenceList();
    if (seqs.length === 0) return null;

    const metaActiveId = (this.playerConfig as any)?.activeSequenceId as string | undefined;
    if (metaActiveId) {
      const found = seqs.find(s => s.id === metaActiveId);
      if (found) return found;
    }

    if (this.activeSequenceId) {
      const found = seqs.find(s => s.id === this.activeSequenceId);
      if (found) return found;
    }
    return null;
  }

  private resetSequenceRuntime(): void {
    this.activeSequenceId = null;
    this.activeSequenceIndex = 0;
    this.activeSequenceElapsedMs = 0;
    this.activeSequenceStepEntered = false;
    this.activeSequenceWasRunning = false;
    this.sequenceJumpTriggered = false;
  }

  private iniciarSecuenciaEnJuego(sequenceId: string) {
    const seqs = this.getSequenceList();
    if (seqs.some(s => s.id === sequenceId)) {
        this.activeSequenceId = sequenceId;
        this.activeSequenceIndex = 0;
        this.activeSequenceElapsedMs = 0;
        this.activeSequenceStepEntered = true;
        this.velocidadY = 0; 
        this.log(`Secuencia iniciada via interacción: ${sequenceId}`);
    } else {
        this.log(`Secuencia no encontrada en el jugador: ${sequenceId}`);
    }
  }

  private syncSequenceStateFromConfig(): PlayerClipSequence | null {
    const seq = this.getSelectedSequence();

    if (!seq) {
      this.resetSequenceRuntime();
      return null;
    }

    if (this.activeSequenceId !== seq.id) {
      this.activeSequenceId = seq.id;
      this.activeSequenceIndex = 0;
      this.activeSequenceElapsedMs = 0;
      this.activeSequenceStepEntered = true;
      this.sequenceJumpTriggered = false;
    }

    return seq;
  }

  private getCurrentSequenceStep(sequence: PlayerClipSequence): PlayerSequenceStep | null {
    if (!sequence.steps || sequence.steps.length === 0) return null;
    const index = Math.max(0, Math.min(this.activeSequenceIndex, sequence.steps.length - 1));
    return sequence.steps[index] || null;
  }

  private resolveSequenceStepAnimation(step: PlayerSequenceStep): AnimationGroup | null {
    const clipOverride = (step.clipOverride || '').trim();
    if (clipOverride) {
      const exact = this.animacionesJugador.find(ag => ag.name.toLowerCase() === clipOverride.toLowerCase());
      if (exact) return exact;

      const contains = this.animacionesJugador.find(ag => ag.name.toLowerCase().includes(clipOverride.toLowerCase()));
      if (contains) return contains;
    }

    return this.getAnimationForAction(step.action);
  }

  private enterSequenceStep(step: PlayerSequenceStep): void {
    this.sequenceJumpTriggered = false;

    if (step.action === 'jumpStart') {
      this.sequenceJumpTriggered = true;
    }

    if (step.action === 'recover') {
      this.isRecoveringFromFall = true;
      this.recoveryFrame = 0;
      this.isHardLanding = false;
    }
  }

  private updateSequencePlayback(
    dtMs: number,
    sequence: PlayerClipSequence | null,
    jugador: Mesh
  ) {
    if (!sequence || !sequence.enabled || !sequence.steps || sequence.steps.length === 0) {
      this.activeSequenceWasRunning = false;
      return { step: null, lockInput: false, allowMovement: true, forceForwardWalk: false, forceForwardRun: false, forceJump: false, animationOverride: null, blend: this.playerConfig.blend.defaultBlend, loop: true, running: false };
    }

    const step = this.getCurrentSequenceStep(sequence);
    if (!step) {
      this.activeSequenceWasRunning = false;
      return { step: null, lockInput: false, allowMovement: true, forceForwardWalk: false, forceForwardRun: false, forceJump: false, animationOverride: null, blend: this.playerConfig.blend.defaultBlend, loop: true, running: false };
    }

    if (this.activeSequenceStepEntered) {
      this.enterSequenceStep(step);
      this.activeSequenceStepEntered = false;
    }

    const animationOverride = this.resolveSequenceStepAnimation(step);
    const blend = typeof step.blend === 'number' ? step.blend : this.playerConfig.blend.defaultBlend;
    const loop = !!step.loop;
    const allowMovement = step.allowMovement !== false;
    const lockInput = !!step.lockInput;

    const lowerAction = step.action;
    const forceForwardWalk = allowMovement && lowerAction === 'walk';
    const forceForwardRun = allowMovement && lowerAction === 'run';
    const forceJump = this.sequenceJumpTriggered && lowerAction === 'jumpStart';

    this.activeSequenceElapsedMs += dtMs;

    if (this.activeSequenceElapsedMs >= Math.max(1, step.durationMs || 1)) {
      this.activeSequenceElapsedMs = 0;
      this.activeSequenceIndex++;

      if (this.activeSequenceIndex >= sequence.steps.length) {
        if (sequence.repeat) {
          this.activeSequenceIndex = 0;
          this.activeSequenceStepEntered = true;
        } else {
          this.resetSequenceRuntime();
          this.activeSequenceWasRunning = false;
          return { step, lockInput, allowMovement, forceForwardWalk, forceForwardRun, forceJump, animationOverride, blend, loop, running: false };
        }
      } else {
        this.activeSequenceStepEntered = true;
      }
    }

    this.activeSequenceWasRunning = true;
    return { step, lockInput, allowMovement, forceForwardWalk, forceForwardRun, forceJump, animationOverride, blend, loop, running: true };
  }

  private loadPlayerConfigFromMetadata(obj: Mesh): void {
    this.playerConfig = mergePlayerConfig(obj.metadata?.playerConfig || null);

    this.walkSpeed = this.playerConfig.movement.walkSpeed;
    this.runSpeed = this.playerConfig.movement.runSpeed;
    this.jumpForce = this.playerConfig.jump.force;
    this.gravedad = this.playerConfig.jump.gravity;

    this.climbForwardMultiplier = this.playerConfig.climb.forwardMultiplier;
    this.climbUpForwardMultiplier = this.playerConfig.climb.climbUpForwardMultiplier;
    this.climbDuration = this.playerConfig.climb.climbDuration;
    this.pullUpDuration = this.playerConfig.climb.pullUpDuration;
    this.postClimbLockFramesRemaining = 0;
  }

  private syncAnimationsFromMetadata(scene: Scene, obj: Mesh): void {
    this.animacionesJugador = [];

    const metadataNames: string[] = obj.metadata?.animationNames || [];
    if (metadataNames.length > 0) {
      this.animacionesJugador = scene.animationGroups.filter(ag => metadataNames.includes(ag.name));
    }

    if (this.animacionesJugador.length === 0) {
      this.animacionesJugador = scene.animationGroups.filter((ag: AnimationGroup) =>
        ag.targetedAnimations.some((ta) => ta.target.parent === obj || ta.target === obj)
      );
    }

    const anims = this.playerConfig.animations;

    this.animIdle = this.resolveAnimation(anims.idle, null);
    this.animWalk = this.resolveAnimation(anims.walk, this.animIdle);
    this.animRun = this.resolveAnimation(anims.run, this.animWalk);
    this.animJump = this.resolveAnimation(anims.jumpStart, this.animIdle);
    this.animJumpLoop = this.resolveAnimation(anims.jumpLoop, this.animJump);
    this.animFall = this.resolveAnimation(anims.fall, this.animJumpLoop || this.animJump);
    this.animLandSoft = this.resolveAnimation(anims.landSoft, this.animIdle);
    this.animHardLanding = this.resolveAnimation(anims.landHard, this.animLandSoft || this.animIdle);
    this.animClimb = this.resolveAnimation(anims.climbUp, this.animIdle);
    this.animClimbFinish = this.resolveAnimation(anims.climbFinish, this.animClimb);
    this.animHangIdle = this.resolveAnimation(anims.hangIdle, this.animClimb);
    this.animVault = this.resolveAnimation(anims.vault, this.animJump);
    this.animStepUp = this.resolveAnimation(anims.stepUp, this.animClimbFinish || this.animIdle);
    this.animRecover = this.resolveAnimation(anims.recover, this.animIdle);

    if (this.animWalk) this.animWalk.speedRatio = 1.0;
    if (this.animRun) this.animRun.speedRatio = 1.0;
    if (this.animClimb) this.animClimb.speedRatio = 0.88;
    if (this.animClimbFinish) this.animClimbFinish.speedRatio = 0.9;
  }

  public iniciarPreviewSecuencia(mesh: AbstractMesh, sequenceId: string) {
    this.detenerPreviewSecuencia(); 

    const trueMesh = mesh as Mesh;
    this.loadPlayerConfigFromMetadata(trueMesh);
    this.syncAnimationsFromMetadata(this.motor3d.scene, trueMesh);

    this.activeSequenceId = sequenceId;
    this.activeSequenceIndex = 0;
    this.activeSequenceElapsedMs = 0;
    this.activeSequenceStepEntered = true;

    this.previewObserver = this.motor3d.scene.onBeforeRenderObservable.add(() => {
      const dtMs = this.motor3d.scene.getEngine().getDeltaTime();
      const seq = this.syncSequenceStateFromConfig();
      const runtime = this.updateSequencePlayback(dtMs, seq, trueMesh);

      if (runtime.running && runtime.animationOverride) {
        this.playAnim(runtime.animationOverride, runtime.loop, runtime.blend);
      } else if (!runtime.running) {
        this.playAnim(this.animIdle, true, 0.1);
      }
    });
  }

  public detenerPreviewSecuencia() {
    if (this.previewObserver) {
      this.motor3d.scene.onBeforeRenderObservable.remove(this.previewObserver);
      this.previewObserver = null;
    }
    this.resetSequenceRuntime();
    if (this.animActual) {
       this.animActual.stop();
       this.animActual = null;
    }
    this.animacionesJugador.forEach(a => a.stop());
  }

  iniciarModoJuego(vista: 'FPS' | 'TPS') {
    const obj = this.state.objetoSeleccionado() as Mesh;
    if (!obj) return;

    this.cameraSvc.guardarEstadoCamaraLibre();

    this.state.playState.set('PLAYING');
    this.state.jugadorActivo = obj;
    this.state.modoVistaPrueba = vista;
    this.state.objetoHovereado.set(null);

    this.state.backupObjetoPosicion = obj.position.clone();
    if (obj.rotationQuaternion) this.state.backupObjetoRotacionQuat = obj.rotationQuaternion.clone();
    else {
      this.state.backupObjetoRotacionQuat = Quaternion.FromEulerAngles(obj.rotation.x, obj.rotation.y, obj.rotation.z);
      obj.rotationQuaternion = this.state.backupObjetoRotacionQuat.clone();
    }
    this.state.backupObjetoVisibilidad = obj.isVisible;
    this.state.backupColisionJugador = obj.checkCollisions;

    this.state.backupColisionesHijos = [];
    obj.getChildMeshes().forEach((m: AbstractMesh) => {
      this.state.backupColisionesHijos.push({ mesh: m, col: m.checkCollisions });
      m.checkCollisions = false;
    });

    obj.checkCollisions = true;
    this.state.objetoSeleccionado.set(null);

    const canvas = this.motor3d.engine.getRenderingCanvas();
    const scene = this.motor3d.scene;

    scene.meshes.forEach(m => {
      if (m === obj) return;
      if (
        m.name.includes('debug') ||
        m.name.includes('gizmo') ||
        m.name.includes('cameraPivot') ||
        m.name.includes('sueloInvisible') ||
        m.name.includes('proxyCol')
      ) return;

      const root = this.state.encontrarRaiz(m as AbstractMesh);
      if (root && root instanceof AbstractMesh && root.metadata?.isSolid) {
        const colMeta = root.metadata.collider;

        if (colMeta && colMeta.type !== 'mesh' && m === root) {
          this.state.backupColisionesHijos.push({ mesh: m, col: m.checkCollisions });
          m.checkCollisions = false;

          m.getChildMeshes().forEach(c => {
            this.state.backupColisionesHijos.push({ mesh: c as AbstractMesh, col: c.checkCollisions });
            c.checkCollisions = false;
          });

          let proxy: Mesh;
          if (colMeta.type === 'capsule') {
            proxy = MeshBuilder.CreateCapsule(`proxyCol_${root.name}`, { radius: colMeta.sizeX, height: colMeta.sizeY * 2 }, scene);
          } else if (colMeta.type === 'sphere') {
            proxy = MeshBuilder.CreateSphere(`proxyCol_${root.name}`, {
              diameterX: colMeta.sizeX * 2,
              diameterY: colMeta.sizeY * 2,
              diameterZ: colMeta.sizeZ * 2
            }, scene);
          } else {
            proxy = MeshBuilder.CreateBox(`proxyCol_${root.name}`, {
              width: colMeta.sizeX * 2,
              height: colMeta.sizeY * 2,
              depth: colMeta.sizeZ * 2
            }, scene);
          }

          proxy.parent = root;
          proxy.position = new Vector3(colMeta.offsetX, colMeta.offsetY, colMeta.offsetZ);
          proxy.isVisible = false;
          proxy.checkCollisions = true;

          this.state.proxyColliders.push(proxy);
        }
      }
    });

    const scale = obj.scaling;
    const isModel = obj.metadata?.type === 'model';

    const defCap = isModel
      ? { sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }
      : { sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };

    const defCam = isModel ? { x: 0, y: 1.6, z: 0 } : { x: 0, y: 0.4, z: 0 };

    const colMeta = obj.metadata?.collider || defCap;
    const camMeta = obj.metadata?.camOffset || defCam;

    this.playerHalfHeight = colMeta.sizeY * scale.y;
    this.playerRadius = Math.max(colMeta.sizeX * scale.x, colMeta.sizeZ * scale.z);

    this.loadPlayerConfigFromMetadata(obj);
    this.syncAnimationsFromMetadata(scene, obj);

    this.playerEyeLevel = this.playerConfig.camera.fpsEyeLevel * scale.y;
    this.currentEyeLevel = this.playerEyeLevel;
    this.currentPivotY = this.playerConfig.camera.tpsPivotY * scale.y;

    obj.ellipsoid = new Vector3(colMeta.sizeX * scale.x, colMeta.sizeY * scale.y, colMeta.sizeZ * scale.z);
    obj.ellipsoidOffset = new Vector3(colMeta.offsetX * scale.x, colMeta.offsetY * scale.y, colMeta.offsetZ * scale.z);

    this.headNode = obj.getChildTransformNodes(false).find(n =>
      n.name.toLowerCase() === 'head' ||
      n.name.toLowerCase() === 'neck' ||
      n.name.toLowerCase().includes('mixamorig:head') ||
      n.name.toLowerCase().includes('head')
    ) as TransformNode;

    if (this.headNode) {
      this.headNode.computeWorldMatrix(true);
      obj.computeWorldMatrix(true);
      this.initialHeadLocal = Vector3.TransformCoordinates(
        this.headNode.getAbsolutePosition(),
        Matrix.Invert(obj.getWorldMatrix())
      );
    } else {
      this.initialHeadLocal = null;
    }

    this.resetMovimientoJugador();

    this.tecladoObserver = scene.onKeyboardObservable.add((kbInfo: KeyboardInfo) => {
      if (this.state.playState() !== 'PLAYING' || !this.state.ratonBloqueado()) return;
      
      const keyStr = kbInfo.event.key ? kbInfo.event.key.toLowerCase() : '';
      const codeStr = kbInfo.event.code ? kbInfo.event.code.toLowerCase() : '';

      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        this.inputMap[keyStr] = true;
        this.inputMap[codeStr] = true;

        const target = this.state.targetInteractuable();
        if (target) {
            // 🔥 LÓGICA REFINADA PARA MÚLTIPLES SECUENCIAS
            if (keyStr === 'e' && this.state.showToastE()) {
                const seqIdRaw = target.metadata?.interactSequenceId;
                if(seqIdRaw) {
                    // Separamos por comas y limpiamos espacios vacíos
                    const ids = seqIdRaw.split(',').map((id: string) => id.trim()).filter((id: string) => id);
                    if (ids.length > 0) {
                        // Buscamos si ya tiene un índice guardado, si no, empezamos en 0
                        let idx = target.metadata.currentSeqIdx || 0;
                        if (idx >= ids.length) idx = 0; // Si llegamos al final, reiniciamos a 0

                        const sequenceToPlay = ids[idx];
                        this.iniciarSecuenciaEnJuego(sequenceToPlay);

                        // Incrementamos el índice para la próxima vez que presione E
                        target.metadata.currentSeqIdx = (idx + 1) % ids.length;
                    }
                }
            }
            if (keyStr === 'i' && this.state.showToastI()) {
                this.abrirMensajeInteractivo(target);
            }
        }
      } else {
        this.inputMap[keyStr] = false;
        this.inputMap[codeStr] = false;
      }
    });

    if (vista === 'FPS') {
      const fpsCam = this.motor3d.playerCameraFPS;
      scene.activeCamera = fpsCam;
      fpsCam.keysUp = [];
      fpsCam.keysDown = [];
      fpsCam.keysLeft = [];
      fpsCam.keysRight = [];
      fpsCam.minZ = 0.05;

      const startRot = obj.rotationQuaternion ? obj.rotationQuaternion.toEulerAngles() : obj.rotation;
      fpsCam.rotation.set(startRot.x, startRot.y, startRot.z);
    } else {
      obj.isVisible = true;
      this.state.cameraPivot = MeshBuilder.CreateBox('cameraPivot', { size: 0.1 }, scene);
      this.state.cameraPivot.isVisible = false;

      obj.computeWorldMatrix(true);
      const localPivotPos = new Vector3(camMeta.x, this.currentPivotY / scale.y, camMeta.z);
      this.state.cameraPivot.position = Vector3.TransformCoordinates(localPivotPos, obj.getWorldMatrix());

      this.motor3d.playerCameraTPS.lockedTarget = this.state.cameraPivot;
      this.motor3d.playerCameraTPS.radius = this.playerConfig.camera.tpsRadius * scale.y;
      scene.activeCamera = this.motor3d.playerCameraTPS;
    }

    this.velocidadY = -0.1;
    this.highestY = obj.position.y;

    this.tpsUpdateObserver = scene.onBeforeRenderObservable.add(() => {
      if (!this.state.jugadorActivo || this.state.playState() !== 'PLAYING' || !this.state.ratonBloqueado()) return;

      const jugador = this.state.jugadorActivo;
      const scaleNow = jugador.scaling;
      const liveConfig = mergePlayerConfig(jugador.metadata?.playerConfig || null);
      this.playerConfig = liveConfig;

      this.walkSpeed = liveConfig.movement.walkSpeed;
      this.runSpeed = liveConfig.movement.runSpeed;
      this.jumpForce = liveConfig.jump.force;
      this.gravedad = liveConfig.jump.gravity;
      this.climbForwardMultiplier = liveConfig.climb.forwardMultiplier;
      this.climbUpForwardMultiplier = liveConfig.climb.climbUpForwardMultiplier;
      this.climbDuration = liveConfig.climb.climbDuration;
      this.pullUpDuration = liveConfig.climb.pullUpDuration;
      this.postClimbLockFramesRemaining = 0;

      const activeCamera = scene.activeCamera;
      if (!activeCamera) return;

      const forward = activeCamera.getDirection(Vector3.Forward());
      forward.y = 0;
      forward.normalize();

      const right = activeCamera.getDirection(Vector3.Right());
      right.y = 0;
      right.normalize();

      jugador.computeWorldMatrix(true);
      const localCapsuleCenter = new Vector3(colMeta.offsetX, colMeta.offsetY, colMeta.offsetZ);
      const capsuleCenter = Vector3.TransformCoordinates(localCapsuleCenter, jugador.getWorldMatrix());

      const collFn = (m: AbstractMesh) =>
        m.checkCollisions &&
        m !== jugador &&
        !this.state.isDescendant(m, jugador) &&
        !m.name.includes('gridHelper');

      let hitInteractuable: AbstractMesh | null = null;
      let hoverInteractable = false;

      // 🔥 LÓGICA DE INTERACCIÓN: FPS (Visión) vs TPS (Proximidad)
      if (vista === 'FPS') {
        const centerRay = scene.createPickingRay(
          this.motor3d.engine.getRenderWidth() / 2,
          this.motor3d.engine.getRenderHeight() / 2,
          Matrix.Identity(),
          activeCamera
        );
        centerRay.length = 10000;

        // Utilizamos pickWithRay para obtener EXACTAMENTE el primer mesh visible que toque el rayo
        const hitCross = scene.pickWithRay(centerRay, (m) => m.isVisible || m.isPickable);
        
        let hoveredRoot: AbstractMesh | null = null;

        if (hitCross && hitCross.hit && hitCross.pickedMesh) {
          const picked = hitCross.pickedMesh as AbstractMesh;
          
          // Si tocamos el suelo o un Helper ignorado, bloqueamos el rayo y no seleccionamos nada.
          if (!this.state.esMeshIgnorable(picked)) {
            const rootNode = this.state.encontrarRaiz(picked);
            if (rootNode && rootNode instanceof AbstractMesh) {
              const adminMode = this.state.rolSimulado() === 'admin';
              if (adminMode || this.state.puedeSeleccionarse(rootNode)) {
                hoveredRoot = rootNode;
                hoverInteractable = adminMode ? true : this.state.esObjetoInteractuable(rootNode);
              }
            }
          }
        }

        this.state.objetoHovereado.set(hoveredRoot);
        this.state.mirandoObjetoInteractuable.set(hoverInteractable);
        
        // En FPS, el objeto interactuable es el que miramos fijamente
        hitInteractuable = hoveredRoot;

      } else {
        // 🔥 TPS PROXIMIDAD AAA (Modo 3ra Persona)
        const playerPos = jugador.getAbsolutePosition();
        let minDist = 3.5 * scaleNow.y;

        scene.meshes.forEach(m => {
            if (m === jugador || m.name.includes("proxyCol") || m.name.includes("suelo") || !m.isVisible) return;
            const root = this.state.encontrarRaiz(m as AbstractMesh);
            if (root && root instanceof AbstractMesh && this.state.esObjetoInteractuable(root)) {
                const dist = Vector3.Distance(playerPos, root.getAbsolutePosition());
                if (dist < minDist) {
                    minDist = dist;
                    hitInteractuable = root;
                }
            }
        });
        
        this.state.mirandoObjetoInteractuable.set(!!hitInteractuable);
        this.state.objetoHovereado.set(null); 
      }

      // 🔥 ACTUALIZAR ESTADO DEL TOAST
      this.state.targetInteractuable.set(hitInteractuable);
      if (hitInteractuable) {
          const meta = hitInteractuable.metadata || {};
          this.state.showToastE.set(!!meta.interactSequenceId && meta.interactSequenceId.trim() !== '');
          this.state.showToastI.set(!!meta.mensaje && meta.mensaje.trim() !== '');
      } else {
          this.state.showToastE.set(false);
          this.state.showToastI.set(false);
      }

      const dtMs = scene.getEngine().getDeltaTime();
      const sequence = this.syncSequenceStateFromConfig();
      const seqRuntime = this.updateSequencePlayback(dtMs, sequence, jugador);

      let move = Vector3.Zero();
      let isMoving = false;
      let isRunning = false;
      let isGrounded = false;

      // 🔥 LÓGICA DE MOVIMIENTO CINEMÁTICO (Evita colisiones al subir/bajar)
      let isCinematicMove = false;
      let dy = 0;
      let df = 0;

      if (seqRuntime.running && seqRuntime.step) {
          const soY = seqRuntime.step.offsetY || 0;
          const soF = seqRuntime.step.offsetForward || 0;
          if (soY !== 0 || soF !== 0) {
              isCinematicMove = true;
              const dtSec = dtMs / 1000;
              const durSec = Math.max(0.001, seqRuntime.step.durationMs / 1000);
              dy = (soY * scaleNow.y / durSec) * dtSec;
              df = (soF * scaleNow.z / durSec) * dtSec;
          }
      }

      const sequenceLocksInput = !!seqRuntime.lockInput;
      const effectiveInput = sequenceLocksInput ? {} : this.inputMap;

      if (seqRuntime.running && seqRuntime.forceJump && !this.isJumping && !this.isFalling) {
        this.velocidadY = this.jumpForce * this.getScaleFactor();
        this.isJumping = true;
        this.sequenceJumpTriggered = false;
      }

      if (this.postClimbLockFramesRemaining > 0) {
        this.postClimbLockFramesRemaining--;
        this.velocidadY = 0;
        move = Vector3.Zero();
      }

      if (this.isClimbing) {
        this.climbFrame++;
        const totalClimbFrames = Math.max(1, this.climbDuration);

        jugador.checkCollisions = false;

        const t = this.clamp01(this.climbFrame / totalClimbFrames);
        const ease = this.easeInOutSmooth(t);

        const currentPos = Vector3.Lerp(this.climbHangPos, this.climbUpEndPos, ease);
        jugador.position = currentPos;
        jugador.computeWorldMatrix(true);

        if (this.climbFrame >= totalClimbFrames) {
          this.isClimbing = false;
          this.isPullingUp = true;
          this.pullUpFrame = 0;
        }
      } else if (this.isPullingUp) {
        this.pullUpFrame++;
        const totalPullFrames = Math.max(1, this.pullUpDuration);

        const t = this.clamp01(this.pullUpFrame / totalPullFrames);
        const easeOut = this.easeOutCubic(t);

        const currentPos = Vector3.Lerp(this.climbUpEndPos, this.climbTopPos, easeOut);
        jugador.position = currentPos;
        jugador.computeWorldMatrix(true);

        if (this.pullUpFrame >= totalPullFrames) {
          this.isPullingUp = false;
          this.justFinishedClimb = true;
          this.postClimbLockFramesRemaining = liveConfig.climb.postClimbLockFrames;

          this.velocidadY = 0;
          this.isJumping = false;
          this.isFalling = false;
          this.highestY = this.climbLedgeTopY + 0.12;

          jugador.checkCollisions = true;

          const safeTopPos = this.climbTopPos.clone();
          safeTopPos.y = this.getClimbStandingY(this.climbLedgeTopY);
          safeTopPos.addInPlace(this.climbForwardDir.scale(this.playerRadius * 0.015));

          jugador.position = safeTopPos;
          jugador.computeWorldMatrix(true);
        }
      } else if (this.isRecoveringFromFall) {
        this.recoveryFrame++;
        if (this.recoveryFrame > liveConfig.physics.landingRecoveryFrames) {
          this.isRecoveringFromFall = false;
        }
      } else {
        if (this.postClimbLockFramesRemaining > 0) {
          isGrounded = true;
          this.isJumping = false;
          this.isFalling = false;
          move = Vector3.Zero();
          move.y = 0;
        } else {

          // 🔥 APLICAMOS MOVIMIENTO CINEMÁTICO DIRECTO Y BYPASSEAMOS COLISIONES
          if (isCinematicMove) {
              jugador.checkCollisions = false;
              jugador.position.y += dy;
              jugador.position.addInPlace(forward.scale(df));
              jugador.computeWorldMatrix(true);

              this.velocidadY = 0;
              this.highestY = jugador.position.y;
              this.isJumping = false;
              this.isFalling = false;
              isGrounded = true;
              move = Vector3.Zero();
              isMoving = true; 
              isRunning = false;
          } else {
              jugador.checkCollisions = true;
              
              if (!this.isHardLanding) {
                if (effectiveInput['w']) move.addInPlace(forward);
                if (effectiveInput['s']) move.subtractInPlace(forward);
                if (effectiveInput['d']) move.addInPlace(right);
                if (effectiveInput['a']) move.subtractInPlace(right);
              }

              if (seqRuntime.running && seqRuntime.allowMovement) {
                if (seqRuntime.forceForwardRun) move.addInPlace(forward.scale(this.runSpeed * this.getScaleFactor()));
                if (seqRuntime.forceForwardWalk) move.addInPlace(forward.scale(this.walkSpeed * this.getScaleFactor()));
              }

              isMoving = move.lengthSquared() > 0.001;
              isRunning = !!effectiveInput['shiftleft'] || !!effectiveInput['shiftright'] || !!effectiveInput['shift'] || seqRuntime.forceForwardRun;

              const scaleFactor = this.getScaleFactor();

              if (isMoving && !this.isHardLanding) {
                const modSpeed = (isRunning ? this.runSpeed : this.walkSpeed) * scaleFactor;

                if (!seqRuntime.running || !seqRuntime.allowMovement) {
                  move.normalize().scaleInPlace(modSpeed);
                }

                if (vista === 'TPS') {
                  const targetAngle = Math.atan2(move.x, move.z);
                  if (!jugador.rotationQuaternion) jugador.rotationQuaternion = Quaternion.Identity();
                  jugador.rotationQuaternion = Quaternion.Slerp(
                    jugador.rotationQuaternion,
                    Quaternion.FromEulerAngles(0, targetAngle, 0),
                    0.1
                  );
                }
              }

              const rayCol = new Ray(capsuleCenter, Vector3.Down(), this.playerHalfHeight + (0.15 * scaleNow.y));
              const hitInfo = scene.pickWithRay(rayCol, collFn);
              isGrounded = hitInfo ? hitInfo.hit : false;

              if (this.velocidadY > 0) isGrounded = false;

              if (isGrounded) {
                if (this.isFalling || this.isJumping) {
                  const fallDistance = this.highestY - jugador.position.y;
                  if (fallDistance > this.playerConfig.physics.hardLandingThreshold * scaleNow.y) {
                    this.isHardLanding = true;
                    this.landingFrame = 0;
                    move = Vector3.Zero();
                  }
                  this.isFalling = false;
                  this.isJumping = false;
                }

                this.highestY = jugador.position.y;
                this.velocidadY = -0.05;

                if ((effectiveInput['space'] || seqRuntime.forceJump) && !this.isHardLanding) {
                  this.velocidadY = this.jumpForce * scaleFactor;
                  this.isJumping = true;
                  this.inputMap['space'] = false;
                }
              } else {
                if (jugador.position.y > this.highestY) this.highestY = jugador.position.y;

                const gravityMul = this.isJumping ? 0.55 : this.playerConfig.jump.jumpFallMultiplier;
                this.velocidadY -= this.gravedad * scaleFactor * gravityMul;

                if (this.velocidadY < -this.playerConfig.jump.maxFallSpeed * scaleFactor) {
                  this.velocidadY = -this.playerConfig.jump.maxFallSpeed * scaleFactor;
                }

                if (this.velocidadY < -0.05) {
                  this.isFalling = true;
                  this.isJumping = false;
                } else if (this.velocidadY > 0) {
                  this.isJumping = true;
                  this.isFalling = false;
                }

                const climbActionsAllowed =
                  liveConfig.climb.enabled &&
                  (this.isActionEnabled('climbUp') || this.isActionEnabled('climbFinish'));

                if (
                  climbActionsAllowed &&
                  (this.isJumping || this.isFalling) &&
                  isMoving &&
                  !this.isClimbing &&
                  !this.isPullingUp &&
                  !this.isHardLanding &&
                  !this.isRecoveringFromFall &&
                  this.postClimbLockFramesRemaining === 0
                ) {
                  const chestOrigin = capsuleCenter.clone();
                  const headOrigin = capsuleCenter.clone();
                  headOrigin.y += this.playerHalfHeight * 0.8;

                  const fDir = this.sanitizeForwardDir(jugador.getDirection(Vector3.Forward()));
                  const reachDistance = this.playerConfig.physics.climbRayReach;

                  const chestRay = new Ray(chestOrigin, fDir, reachDistance);
                  const chestHit = scene.pickWithRay(chestRay, collFn);

                  const headRay = new Ray(headOrigin, fDir, reachDistance);
                  const headHit = scene.pickWithRay(headRay, collFn);

                  if (chestHit && chestHit.hit && (!headHit || !headHit.hit)) {
                    const originTop = chestHit.pickedPoint!.clone();
                    originTop.y += this.playerHalfHeight * 3.5;
                    originTop.addInPlace(fDir.scale(this.playerRadius * 0.35));

                    const rayTop = new Ray(originTop, Vector3.Down(), this.playerHalfHeight * 6);
                    const hitTop = scene.pickWithRay(rayTop, collFn);

                    if (hitTop && hitTop.hit) {
                      const ledgeMesh = (hitTop.pickedMesh as AbstractMesh) || (chestHit.pickedMesh as AbstractMesh) || null;
                      this.climbLedgeMesh = ledgeMesh;

                      let exactTargetY = this.getWorldTopY(ledgeMesh, hitTop.pickedPoint!.y);
                      exactTargetY = this.getClimbStandingY(exactTargetY);

                      const heightDiff = exactTargetY - jugador.position.y;

                      if (
                        heightDiff > (this.playerHalfHeight * liveConfig.climb.minHeight) &&
                        heightDiff <= (this.playerHalfHeight * liveConfig.climb.maxHeight)
                      ) {
                        const idealStartPos = this.getSafeGrabStartPos(
                          chestHit.pickedPoint!.clone(),
                          fDir,
                          jugador.position.y
                        );

                        this.iniciarEscalada(exactTargetY, fDir, idealStartPos, isModel, ledgeMesh);
                      }
                    }
                  }
                }
              }

              move.y = this.velocidadY;
          }
        }
      }

      if (
        !this.isClimbing &&
        !this.isPullingUp &&
        !this.isHardLanding &&
        !this.isRecoveringFromFall &&
        this.postClimbLockFramesRemaining === 0
      ) {
         if (!isCinematicMove) {
            jugador.moveWithCollisions(move);
         }
      }

      if (seqRuntime.running && seqRuntime.animationOverride) {
        this.playAnim(seqRuntime.animationOverride, seqRuntime.loop, seqRuntime.blend);
      } else if (this.isClimbing) {
        if (this.isActionEnabled('climbUp')) this.playAnim(this.animClimb || this.animIdle, false, 0.06);
        else this.playAnim(this.animIdle, true, 0.06);
      } else if (this.isPullingUp) {
        if (this.isActionEnabled('climbFinish')) this.playAnim(this.animClimbFinish || this.animClimb || this.animIdle, false, 0.05);
        else this.playAnim(this.animIdle, true, 0.05);
      } else if (this.isHardLanding) {
        if (this.isActionEnabled('landHard')) this.playAnim(this.animHardLanding || this.animLandSoft || this.animIdle, false, 0.1);
        else this.playAnim(this.animIdle, true, 0.1);

        this.landingFrame++;
        if (this.landingFrame > liveConfig.physics.landingRecoveryFrames) {
          this.isHardLanding = false;
          this.isRecoveringFromFall = true;
          this.recoveryFrame = 0;
        }
      } else if (this.isRecoveringFromFall) {
        if (this.isActionEnabled('recover')) this.playAnim(this.animRecover || this.animIdle, false, 0.05);
        else this.playAnim(this.animIdle, true, 0.05);
      } else if (this.isJumping || this.isFalling) {
        if (this.isFalling) {
          if (this.isActionEnabled('fall')) this.playAnim(this.animFall || this.animJumpLoop || this.animJump || this.animIdle, false, 0.08);
          else this.playAnim(this.animIdle, true, 0.08);
        } else {
          if (this.isActionEnabled('jumpStart')) this.playAnim(this.animJump || this.animJumpLoop || this.animIdle, false, 0.08);
          else this.playAnim(this.animIdle, true, 0.08);
        }
      } else {
        const finalBlendSpeed = liveConfig.blend.defaultBlend ?? 0.1;

        if (isMoving) {
          if (isRunning) {
            if (this.isActionEnabled('run')) this.playAnim(this.animRun || this.animWalk || this.animIdle, true, finalBlendSpeed);
            else this.playAnim(this.animIdle, true, finalBlendSpeed);
          } else {
            if (this.isActionEnabled('walk')) this.playAnim(this.animWalk || this.animIdle, true, finalBlendSpeed);
            else this.playAnim(this.animIdle, true, finalBlendSpeed);
          }
        } else {
          if (this.isActionEnabled('idle')) this.playAnim(this.animIdle, true, finalBlendSpeed);
          else this.playAnim(null, true, finalBlendSpeed);
        }

        this.justFinishedClimb = false;
      }

      let targetEyeLevel = this.playerEyeLevel;
      let targetPivotY = this.playerConfig.camera.tpsPivotY * scaleNow.y;

      let breathY = 0;
      let breathZ = 0;
      let breathX = 0;

      if (this.playerConfig.camera.headFollow && this.headNode && this.initialHeadLocal) {
        const currentGlobal = this.headNode.getAbsolutePosition();
        const currentLocal = Vector3.TransformCoordinates(
          currentGlobal,
          Matrix.Invert(jugador.getWorldMatrix())
        );

        breathX = currentLocal.x - this.initialHeadLocal.x;
        breathY = currentLocal.y - this.initialHeadLocal.y;
        breathZ = currentLocal.z - this.initialHeadLocal.z;
      } else {
        if (this.isHardLanding) {
          const progress = this.landingFrame / Math.max(1, this.playerConfig.physics.landingRecoveryFrames);
          const dip = Math.sin(progress * Math.PI);
          targetEyeLevel -= dip * (this.playerHalfHeight * 1.2);
          targetPivotY -= dip * (this.playerHalfHeight * 1.2);
        }

        if (this.isPullingUp) {
          const progreso = this.clamp01(this.pullUpFrame / Math.max(1, this.pullUpDuration));
          const easeOut = this.easeOutCubic(progreso);
          const fakeY = this.climbUpEndPos.y + (this.climbTopPos.y - this.climbUpEndPos.y) * easeOut;
          const diffY = fakeY - jugador.position.y;
          targetEyeLevel += diffY * 0.35;
          targetPivotY += diffY * 0.35;
        }

        if (
          !isMoving &&
          isGrounded &&
          !this.isClimbing &&
          !this.isPullingUp &&
          !this.isHardLanding &&
          this.postClimbLockFramesRemaining === 0
        ) {
          this.idleTime += scene.getEngine().getDeltaTime() / 1000;
          breathY = Math.sin(this.idleTime * 2.5) * 0.015;
          breathZ = Math.cos(this.idleTime * 2.5) * 0.015;
        } else {
          this.idleTime = 0;
        }
      }

      this.currentEyeLevel += (targetEyeLevel - this.currentEyeLevel) * 0.06;
      this.currentPivotY += (targetPivotY - this.currentPivotY) * 0.06;

      jugador.computeWorldMatrix(true);

      if (vista === 'TPS' && this.state.cameraPivot) {
        this.motor3d.playerCameraTPS.radius = this.playerConfig.camera.tpsRadius * scaleNow.y;

        const localPivotPos = new Vector3(
          camMeta.x + breathX,
          (this.currentPivotY / scaleNow.y) + breathY,
          camMeta.z + breathZ
        );
        const globalPivotPos = Vector3.TransformCoordinates(localPivotPos, jugador.getWorldMatrix());

        this.state.cameraPivot.position = Vector3.Lerp(
          this.state.cameraPivot.position,
          globalPivotPos,
          0.1
        );
      }

      if (vista === 'FPS') {
        const fpsCam = scene.activeCamera as UniversalCamera;

        if (!jugador.rotationQuaternion) jugador.rotationQuaternion = Quaternion.Identity();
        jugador.rotationQuaternion = Quaternion.FromEulerAngles(0, fpsCam.rotation.y, 0);

        const localCamPos = new Vector3(
          camMeta.x + breathX,
          (this.currentEyeLevel / scaleNow.y) + breathY,
          camMeta.z + breathZ
        );

        const globalCamPos = Vector3.TransformCoordinates(localCamPos, jugador.getWorldMatrix());
        fpsCam.position = globalCamPos;
      }
    });

    if (canvas) {
      canvas.focus();
      try {
        scene.activeCamera!.attachControl(canvas, true);
        canvas.requestPointerLock();
      } catch {}
    }
  }

  private iniciarEscalada(
    targetY: number,
    forwardDir: Vector3,
    startPosIdeal: Vector3,
    isModel: boolean,
    ledgeMesh: AbstractMesh | null
  ) {
    this.isClimbing = true;
    this.isPullingUp = false;
    this.isRecoveringFromFall = false;
    this.justFinishedClimb = false;
    this.velocidadY = 0;
    this.climbFrame = 0;
    this.pullUpFrame = 0;
    this.postClimbLockFramesRemaining = 0;

    const cleanForward = this.sanitizeForwardDir(forwardDir);

    this.climbLedgeMesh = ledgeMesh;
    this.climbLedgeTopY = this.getWorldTopY(ledgeMesh, targetY);

    this.climbHangPos = startPosIdeal.clone();
    this.climbStartY = startPosIdeal.y;
    this.climbTargetY = targetY;
    this.climbForwardDir = cleanForward.clone();

    const visual = this.getClimbVisualY(this.climbLedgeTopY, this.climbStartY, isModel);

    this.climbHangPos.y = visual.hangY;

    this.climbUpEndPos = this.climbHangPos.clone();
    this.climbUpEndPos.addInPlace(cleanForward.scale(this.playerRadius * this.climbUpForwardMultiplier));
    this.climbUpEndPos.y = visual.upY;

    this.climbTopPos = this.climbUpEndPos.clone();
    this.climbTopPos.addInPlace(cleanForward.scale(this.playerRadius * this.climbForwardMultiplier));
    this.climbTopPos.y = visual.topY;

    this.state.jugadorActivo!.position = this.climbHangPos.clone();
    this.state.jugadorActivo!.computeWorldMatrix(true);

    this.isJumping = false;
    this.isFalling = false;
    this.isHardLanding = false;

    this.playAnim(this.animClimb || this.animIdle, false, 0.06);
  }

  detenerModoJuego() {
    const scene = this.motor3d.scene;
    this.state.playState.set('EDITOR');

    this.log('Deteniendo modo juego');

    this.resetMovimientoJugador();
    scene.stopAllAnimations();

    const currentCam = scene.activeCamera;
    let camPos = currentCam!.globalPosition.clone();
    let camTarget = camPos.add(currentCam!.getDirection(Vector3.Forward()).scale(10));

    this.motor3d.playerCameraFPS.detachControl();
    this.motor3d.playerCameraTPS.detachControl();

    this.motor3d.editorCamera.position = camPos;
    this.motor3d.editorCamera.setTarget(camTarget);

    scene.activeCamera = this.motor3d.editorCamera;
    this.motor3d.editorCamera.attachControl(this.motor3d.engine.getRenderingCanvas(), true);

    if (this.state.cameraPivot) {
      this.state.cameraPivot.dispose();
      this.state.cameraPivot = null;
    }
    if (this.tecladoObserver) scene.onKeyboardObservable.remove(this.tecladoObserver);
    if (this.tpsUpdateObserver) scene.onBeforeRenderObservable.remove(this.tpsUpdateObserver);

    this.state.proxyColliders.forEach(p => p.dispose());
    this.state.proxyColliders = [];

    this.tecladoObserver = null;
    this.tpsUpdateObserver = null;
    this.inputMap = {};
    this.eKeyPressed = false;
    this.iKeyPressed = false;
    this.resetSequenceRuntime();

    this.state.objetoHovereado.set(null);
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.objetoSeleccionado.set(null);

    this.headNode = null;
    this.initialHeadLocal = null;
    this.climbLedgeMesh = null;
    this.climbLedgeTopY = 0;

    if (this.state.jugadorActivo && this.state.backupObjetoPosicion && this.state.backupObjetoRotacionQuat) {
      if (this.state.jugadorActivo.metadata?.rol === 'npc' || this.state.jugadorActivo.metadata?.rol === 'spawn_point') {
        if (this.state.modoVistaPrueba === 'FPS') {
          this.state.jugadorActivo.rotationQuaternion = Quaternion.FromEulerAngles(
            0,
            (this.motor3d.playerCameraFPS as any).rotation.y,
            0
          );
        }
        this.state.triggerUpdate();
      } else {
        this.state.jugadorActivo.position = this.state.backupObjetoPosicion;
        this.state.jugadorActivo.rotationQuaternion = this.state.backupObjetoRotacionQuat.clone();
      }

      this.state.jugadorActivo.isVisible = this.state.backupObjetoVisibilidad;
      this.state.jugadorActivo.checkCollisions = this.state.backupColisionJugador;

      this.state.backupColisionesHijos.forEach(item => {
        if (item.mesh) item.mesh.checkCollisions = item.col;
      });
      this.state.backupColisionesHijos = [];
    }

    if (this.state.jugadorActivo) this.state.objetoSeleccionado.set(this.state.jugadorActivo);

    this.state.jugadorActivo = null;
    this.state.backupObjetoPosicion = null;
    this.state.backupObjetoRotacionQuat = null;
    this.state.modoVistaPrueba = null;

    if (document.pointerLockElement) document.exitPointerLock();
  }

  public resetMovimientoJugador(): void {
    this.inputMap = {};
    this.isJumping = false;
    this.isFalling = false;
    this.isHardLanding = false;
    this.isClimbing = false;
    this.isPullingUp = false;
    this.isRecoveringFromFall = false;
    this.justFinishedClimb = false;
    this.postClimbLockFramesRemaining = 0;
    this.velocidadY = -0.1;
    this.highestY = -9999;
    this.idleTime = 0;
    this.eKeyPressed = false;
    this.iKeyPressed = false;
    this.state.mirandoObjetoInteractuable.set(false);
    this.state.targetInteractuable.set(null);
    this.state.showToastE.set(false);
    this.state.showToastI.set(false);
    this.resetSequenceRuntime();
    this.playAnim(this.animIdle, true);
  }

  private playAnim(anim: AnimationGroup | null, loop: boolean, blendingSpeed: number = 0.05) {
    if (!anim) {
      this.animacionesJugador.forEach(a => a.stop());
      this.animActual = null;
      return;
    }

    if (this.animActual === anim) {
      if (anim.isPlaying) return;
      anim.reset();
    } else {
      this.animacionesJugador.forEach(a => {
        if (a !== anim) a.stop();
      });
      anim.reset();
      this.animActual = anim;
    }

    anim.enableBlending = blendingSpeed > 0;
    anim.blendingSpeed = blendingSpeed;
    anim.play(loop);
    this.animActual = anim;
  }
}