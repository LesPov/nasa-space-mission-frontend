import { Injectable, inject } from '@angular/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';
import { EditorCameraService } from './editor-camera.service';
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

@Injectable({ providedIn: 'root' })
export class EditorPlayerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private cameraSvc = inject(EditorCameraService);

  private playerHalfHeight: number = 0.9;
  private playerEyeLevel: number = 1.6;
  private playerRadius: number = 0.4;
  
  private headNode: TransformNode | null = null;
  private initialHeadLocal: Vector3 | null = null;
  
  private currentEyeLevel: number = 1.6;
  private currentPivotY: number = 1.5;
  private idleTime: number = 0; 
  
  private velocidadY: number = 0;
  private gravedad: number = 0.022; 
  private jumpForce = 0.28; 
  private highestY: number = -9999; 
  
  private isJumping: boolean = false;
  private isFalling: boolean = false;
  private isHardLanding: boolean = false; 
  private isClimbing: boolean = false;
  
  private climbFrame: number = 0;
  private landingFrame: number = 0;
  private climbStartY: number = 0;
  private climbTargetY: number = 0;
  private climbForwardDir: Vector3 = Vector3.Zero();
  
  private walkSpeed = 0.08;
  private runSpeed = 0.18;
  
  private animacionesJugador: AnimationGroup[] = [];
  private animActual: AnimationGroup | null = null;
  
  private animIdle: AnimationGroup | null = null;
  private animWalk: AnimationGroup | null = null;
  private animRun: AnimationGroup | null = null;
  private animJump: AnimationGroup | null = null;
  private animHardLanding: AnimationGroup | null = null;
  private animClimb: AnimationGroup | null = null;
  private animFall: any;

  private inputMap: Record<string, boolean> = {};
  private tecladoObserver: Observer<KeyboardInfo> | null = null;
  private tpsUpdateObserver: Observer<Scene> | null = null;

  constructor() {
    document.addEventListener('pointerlockchange', () => {
      const isLocked = !!document.pointerLockElement;
      this.state.ratonBloqueado.set(isLocked);

      if (!isLocked) {
        const stateStr = this.state.playState();
        if (stateStr === 'PLAYING' || stateStr === 'EDITING_IN_GAME' || stateStr === 'TRANSITIONING' || stateStr === 'INTERACTING') {
          this.resetMovimientoJugador();
        }
      }
    });
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
    if (obj.rotationQuaternion) {
      this.state.backupObjetoRotacionQuat = obj.rotationQuaternion.clone();
    } else {
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

    // 🔥 CREAR PROXYS DE COLISIÓN PARA PROPS (Muros y obstáculos optimizados)
    scene.meshes.forEach(m => {
        if (m === obj) return; 
        if (m.name.includes("debug") || m.name.includes("gizmo") || m.name.includes("cameraPivot") || m.name.includes("sueloInvisible") || m.name.includes("proxyCol")) return;
        
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
                    proxy = MeshBuilder.CreateCapsule("proxyCol_" + root.name, { radius: colMeta.sizeX, height: colMeta.sizeY * 2 }, scene);
                } else if (colMeta.type === 'sphere') {
                    proxy = MeshBuilder.CreateSphere("proxyCol_" + root.name, { diameterX: colMeta.sizeX * 2, diameterY: colMeta.sizeY * 2, diameterZ: colMeta.sizeZ * 2 }, scene);
                } else {
                    proxy = MeshBuilder.CreateBox("proxyCol_" + root.name, { width: colMeta.sizeX * 2, height: colMeta.sizeY * 2, depth: colMeta.sizeZ * 2 }, scene);
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
    
    const defCap = isModel ? { sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 } : { sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, offsetX: 0, offsetY: 0, offsetZ: 0 };
    const defCam = isModel ? { x: 0, y: 1.6, z: 0 } : { x: 0, y: 0.4, z: 0 };

    const colMeta = obj.metadata?.collider || defCap;
    const camMeta = obj.metadata?.camOffset || defCam;

    this.playerHalfHeight = colMeta.sizeY * scale.y;
    this.playerEyeLevel = camMeta.y * scale.y;
    this.playerRadius = Math.max(colMeta.sizeX * scale.x, colMeta.sizeZ * scale.z);
    
    this.currentEyeLevel = this.playerEyeLevel;
    this.currentPivotY = this.playerHalfHeight * 1.5;

    obj.ellipsoid = new Vector3(colMeta.sizeX * scale.x, colMeta.sizeY * scale.y, colMeta.sizeZ * scale.z);
    obj.ellipsoidOffset = new Vector3(colMeta.offsetX * scale.x, colMeta.offsetY * scale.y, colMeta.offsetZ * scale.z);

    this.animacionesJugador = obj.metadata?.animations || [];
    if (this.animacionesJugador.length === 0) {
        this.animacionesJugador = scene.animationGroups.filter((ag: AnimationGroup) => 
            ag.targetedAnimations.some((ta) => ta.target.parent === obj || ta.target === obj)
        );
    }

    const buscarAnim = (claves: string[]) => {
      return this.animacionesJugador.find(a => claves.some(c => a.name.toLowerCase().includes(c))) || null;
    };

    this.animIdle = buscarAnim(['idle']);
    this.animWalk = buscarAnim(['walk']);
    this.animRun = buscarAnim(['run']);
    this.animJump = buscarAnim(['jump start', 'jump']);
    this.animFall = buscarAnim(['falling', 'fall']); 
    this.animHardLanding = buscarAnim(['hard landing']); 
    this.animClimb = buscarAnim(['climb up', 'climb']);

    if (!this.animWalk) this.animWalk = this.animIdle;
    if (!this.animRun) this.animRun = this.animWalk;
    if (!this.animJump) this.animJump = this.animIdle;
    if (!this.animFall) this.animFall = this.animJump; 
    if (!this.animHardLanding) this.animHardLanding = this.animIdle;

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
      if (kbInfo.event.key) {
        this.inputMap[kbInfo.event.key.toLowerCase()] = kbInfo.type === KeyboardEventTypes.KEYDOWN;
        this.inputMap[kbInfo.event.code.toLowerCase()] = kbInfo.type === KeyboardEventTypes.KEYDOWN;
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
      this.state.cameraPivot = MeshBuilder.CreateBox("cameraPivot", { size: 0.1 }, scene);
      this.state.cameraPivot.isVisible = false;

      obj.computeWorldMatrix(true);
      const localPivotPos = new Vector3(camMeta.x, this.currentPivotY / scale.y, camMeta.z);
      this.state.cameraPivot.position = Vector3.TransformCoordinates(localPivotPos, obj.getWorldMatrix());

      this.motor3d.playerCameraTPS.lockedTarget = this.state.cameraPivot;
      this.motor3d.playerCameraTPS.radius = 5 * scale.y; 
      scene.activeCamera = this.motor3d.playerCameraTPS;
    }

    this.velocidadY = -0.1;
    this.highestY = obj.position.y; 

    // 🚀 BUCLE PRINCIPAL DE FÍSICAS Y ANIMACIONES 🚀
    this.tpsUpdateObserver = scene.onBeforeRenderObservable.add(() => {
      if (!this.state.jugadorActivo || this.state.playState() !== 'PLAYING' || !this.state.ratonBloqueado()) return;

      if (vista === 'FPS') {
        const w = this.motor3d.engine.getRenderWidth();
        const h = this.motor3d.engine.getRenderHeight();
        const crosshairRay = scene.createPickingRay(w / 2, h / 2, Matrix.Identity(), scene.activeCamera);
        const hitCross = scene.pickWithRay(crosshairRay, (m) => m.checkCollisions && m !== this.state.jugadorActivo);

        if (hitCross && hitCross.hit && hitCross.pickedMesh && this.state.puedeSeleccionarse(hitCross.pickedMesh as AbstractMesh)) {
          const rootNode = this.state.encontrarRaiz(hitCross.pickedMesh as AbstractMesh);
          this.state.objetoHovereado.set(rootNode ? (rootNode as AbstractMesh) : null);
          this.state.mirandoObjetoInteractuable.set(!!rootNode);
        } else {
          this.state.mirandoObjetoInteractuable.set(false);
          this.state.objetoHovereado.set(null);
        }
      }

      let move = Vector3.Zero();
      let isMoving = false;
      let isRunning = false;
      let isGrounded = false;

      // ==========================================
      // 1. LÓGICA DE MOVIMIENTO DEPENDIENDO DEL ESTADO
      // ==========================================
      
      if (this.isClimbing) {
        this.climbFrame++;
        const totalFrames = 42; 

        this.state.jugadorActivo.checkCollisions = false;

        if (this.climbFrame >= totalFrames) {
            this.state.jugadorActivo.position.y = this.climbTargetY;
            this.state.jugadorActivo.position.addInPlace(this.climbForwardDir.scale(this.playerRadius * 2));
            this.state.jugadorActivo.computeWorldMatrix(true);

            this.isClimbing = false;
            this.velocidadY = -0.05; 
            this.highestY = this.state.jugadorActivo.position.y; 
            this.state.jugadorActivo.checkCollisions = true; 
        }

      } else {
        let forward = scene.activeCamera!.getDirection(Vector3.Forward());
        forward.y = 0; forward.normalize();
        let right = scene.activeCamera!.getDirection(Vector3.Right());
        right.y = 0; right.normalize();

        if (!this.isHardLanding) {
            if (this.inputMap['w']) move.addInPlace(forward);
            if (this.inputMap['s']) move.subtractInPlace(forward);
            if (this.inputMap['d']) move.addInPlace(right);
            if (this.inputMap['a']) move.subtractInPlace(right);
        }

        isMoving = move.lengthSquared() > 0.001;
        isRunning = this.inputMap['shiftleft'] || this.inputMap['shiftright'] || this.inputMap['shift'];

        const scaleFactor = (this.playerHalfHeight / 0.9);

        if (isMoving) {
          let modSpeed = (isRunning ? this.runSpeed : this.walkSpeed) * scaleFactor;
          move.normalize().scaleInPlace(modSpeed);
          
          if (vista === 'TPS') {
            let targetAngle = Math.atan2(move.x, move.z);
            if (!this.state.jugadorActivo.rotationQuaternion) this.state.jugadorActivo.rotationQuaternion = Quaternion.Identity();
            this.state.jugadorActivo.rotationQuaternion = Quaternion.Slerp(
              this.state.jugadorActivo.rotationQuaternion,
              Quaternion.FromEulerAngles(0, targetAngle, 0),
              0.15
            );
          }
        }

        this.state.jugadorActivo.computeWorldMatrix(true);
        const localCapsuleCenter = new Vector3(colMeta.offsetX, colMeta.offsetY, colMeta.offsetZ);
        const capsuleCenter = Vector3.TransformCoordinates(localCapsuleCenter, this.state.jugadorActivo.getWorldMatrix());

        const rayCol = new Ray(capsuleCenter, Vector3.Down(), this.playerHalfHeight + (0.15 * scale.y)); 
        const collFn = (m: AbstractMesh) => m.checkCollisions && m !== this.state.jugadorActivo && !this.state.isDescendant(m, this.state.jugadorActivo!) && !m.name.includes('gridHelper');
        const hitInfo = scene.pickWithRay(rayCol, collFn);
        
        isGrounded = hitInfo ? hitInfo.hit : false;

        if (this.velocidadY > 0) isGrounded = false; 

        if (isGrounded) {
            if (this.isFalling || this.isJumping) {
                const fallDistance = this.highestY - this.state.jugadorActivo.position.y;
                
                if (fallDistance > 2.5 * scale.y || this.isJumping) { 
                    this.isHardLanding = true;
                    this.landingFrame = 0;
                    move = Vector3.Zero(); 
                } 
                this.isFalling = false;
                this.isJumping = false;
            }

            this.highestY = this.state.jugadorActivo.position.y; 
            this.velocidadY = -0.05; 
            
            if (this.inputMap['space'] && !this.isHardLanding) {
                this.velocidadY = this.jumpForce * scaleFactor;
                this.isJumping = true;
                this.inputMap['space'] = false; 
            }

        } else {
            if (this.state.jugadorActivo.position.y > this.highestY) {
                this.highestY = this.state.jugadorActivo.position.y;
            }

            this.velocidadY -= this.gravedad * scaleFactor;
            if (this.velocidadY < -0.8 * scaleFactor) this.velocidadY = -0.8 * scaleFactor; 
            
            if (this.velocidadY < -0.05) {
                this.isFalling = true;
                this.isJumping = false;
            } else if (this.velocidadY > 0) {
                this.isJumping = true;
                this.isFalling = false;
            }

            if ((this.isJumping || this.isFalling) && isMoving && !this.isClimbing) {
                const chestOrigin = capsuleCenter.clone();
                const headOrigin = capsuleCenter.clone();
                headOrigin.y += this.playerHalfHeight * 0.8; 
                
                const fDir = this.state.jugadorActivo.getDirection(Vector3.Forward());
                fDir.y = 0; fDir.normalize();
                
                const reachDistance = this.playerRadius * 2.5; 
                
                const chestRay = new Ray(chestOrigin, fDir, reachDistance);
                const chestHit = scene.pickWithRay(chestRay, collFn);
                
                const headRay = new Ray(headOrigin, fDir, reachDistance);
                const headHit = scene.pickWithRay(headRay, collFn);
                
                if (chestHit && chestHit.hit && (!headHit || !headHit.hit)) {
                    let originTop = chestHit.pickedPoint!.clone();
                    originTop.y += this.playerHalfHeight * 4; 
                    originTop.addInPlace(fDir.scale(this.playerRadius)); 

                    let rayTop = new Ray(originTop, Vector3.Down(), this.playerHalfHeight * 5); 
                    let hitTop = scene.pickWithRay(rayTop, collFn);

                    if (hitTop && hitTop.hit) {
                        let offsetCorreccion = (isModel) ? 0 : (this.playerHalfHeight);
                        let exactTargetY = hitTop.pickedPoint!.y + offsetCorreccion + 0.02;
                        
                        if (exactTargetY - this.state.jugadorActivo.position.y <= this.playerHalfHeight * 3.5) {
                            this.iniciarEscalada(exactTargetY, fDir);
                        }
                    }
                }
            }
        }
        
        move.y = this.velocidadY;
      } 

      if (!this.isClimbing) {
          this.state.jugadorActivo.moveWithCollisions(move);
      }

      // ==========================================
      // ANIMACIONES
      // ==========================================
      if (this.isClimbing) {
          this.playAnim(this.animClimb, false);
      } 
      else if (this.isHardLanding) {
          this.playAnim(this.animHardLanding, false);
          this.landingFrame++;
          if (this.landingFrame > 60) { this.isHardLanding = false; }
      }
      else if (this.isJumping || this.isFalling) {
          this.playAnim(this.animJump, false); 
      } 
      else {
          if (isMoving) {
              this.playAnim(isRunning ? this.animRun : this.animWalk, true);
          } else {
              this.playAnim(this.animIdle, true);
          }
      }

      // ==========================================
      // POSICIÓN PERFECTA DE CÁMARA (AAA SYSTEM)
      // ==========================================
      let targetEyeLevel = this.playerEyeLevel;
      let targetPivotY = this.playerHalfHeight * 1.5;

      let breathY = 0;
      let breathZ = 0;
      let breathX = 0;

      if (this.headNode && this.initialHeadLocal) {
          const currentGlobal = this.headNode.getAbsolutePosition();
          const currentLocal = Vector3.TransformCoordinates(currentGlobal, Matrix.Invert(this.state.jugadorActivo.getWorldMatrix()));
          
          breathX = currentLocal.x - this.initialHeadLocal.x;
          breathY = currentLocal.y - this.initialHeadLocal.y;
          breathZ = currentLocal.z - this.initialHeadLocal.z;
      } 
      else if (!this.headNode) {
          if (this.isHardLanding) {
              let progress = this.landingFrame / 60; 
              let dip = Math.sin(progress * Math.PI); 
              targetEyeLevel -= dip * (this.playerHalfHeight * 1.2); 
              targetPivotY -= dip * (this.playerHalfHeight * 1.2);
          } 

          if (this.isClimbing) {
              let progreso = this.climbFrame / 42;
              let easeOut = 1 - Math.pow(1 - progreso, 3);
              let fakeY = this.climbStartY + (this.climbTargetY - this.climbStartY) * easeOut;
              
              targetEyeLevel = (fakeY - this.state.jugadorActivo.position.y) + this.playerEyeLevel;
              targetPivotY = (fakeY - this.state.jugadorActivo.position.y) + (this.playerHalfHeight * 1.5);
          }

          if (!isMoving && isGrounded && !this.isClimbing && !this.isHardLanding && isModel) {
              this.idleTime += scene.getEngine().getDeltaTime() / 1000;
              breathY = Math.sin(this.idleTime * 2.5) * 0.015; 
              breathZ = Math.cos(this.idleTime * 2.5) * 0.015; 
          } else {
              this.idleTime = 0;
          }
      }

      this.currentEyeLevel += (targetEyeLevel - this.currentEyeLevel) * 0.15;
      this.currentPivotY += (targetPivotY - this.currentPivotY) * 0.15;

      this.state.jugadorActivo.computeWorldMatrix(true);

      if (vista === 'TPS' && this.state.cameraPivot) {
        const localPivotPos = new Vector3(camMeta.x + breathX, (this.currentPivotY / scale.y) + breathY, camMeta.z + breathZ);
        const globalPivotPos = Vector3.TransformCoordinates(localPivotPos, this.state.jugadorActivo.getWorldMatrix());
        
        this.state.cameraPivot.position = Vector3.Lerp(
          this.state.cameraPivot.position,
          globalPivotPos,
          0.3 
        );
      }

      if (vista === 'FPS') {
        const fpsCam = scene.activeCamera as UniversalCamera;
        
        if (!this.state.jugadorActivo.rotationQuaternion) this.state.jugadorActivo.rotationQuaternion = Quaternion.Identity();
        this.state.jugadorActivo.rotationQuaternion = Quaternion.FromEulerAngles(0, fpsCam.rotation.y, 0);
        
        const localCamPos = new Vector3(
            camMeta.x + breathX, 
            (this.currentEyeLevel / scale.y) + breathY, 
            camMeta.z + breathZ
        );
        
        fpsCam.position = Vector3.TransformCoordinates(localCamPos, this.state.jugadorActivo.getWorldMatrix());
      }

    });

    if (canvas) {
      canvas.focus();
      try {
        scene.activeCamera!.attachControl(canvas, true);
        canvas.requestPointerLock();
      } catch (e) { }
    }
  }

  private iniciarEscalada(targetY: number, forwardDir: Vector3) {
    this.isClimbing = true;
    this.velocidadY = 0; 
    this.climbFrame = 0;
    
    this.climbStartY = this.state.jugadorActivo!.position.y;
    this.climbTargetY = targetY; 
    this.climbForwardDir = forwardDir.clone(); 

    this.isJumping = false;
    this.isFalling = false;
    this.isHardLanding = false;

    this.playAnim(this.animClimb, false);
  }

  detenerModoJuego() {
    const scene = this.motor3d.scene;
    this.state.playState.set('EDITOR');

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

    if (this.state.cameraPivot) { this.state.cameraPivot.dispose(); this.state.cameraPivot = null; }
    if (this.tecladoObserver) scene.onKeyboardObservable.remove(this.tecladoObserver);
    if (this.tpsUpdateObserver) scene.onBeforeRenderObservable.remove(this.tpsUpdateObserver);

    this.state.proxyColliders.forEach(p => p.dispose());
    this.state.proxyColliders = [];

    this.tecladoObserver = null; 
    this.tpsUpdateObserver = null;
    this.inputMap = {};

    this.state.objetoHovereado.set(null);
    this.state.objetoSeleccionado.set(null);

    this.headNode = null;
    this.initialHeadLocal = null;

    if (this.state.jugadorActivo && this.state.backupObjetoPosicion && this.state.backupObjetoRotacionQuat) {
      if (this.state.jugadorActivo.metadata?.rol === 'npc' || this.state.jugadorActivo.metadata?.rol === 'spawn_point') {
        if (this.state.modoVistaPrueba === 'FPS') {
            this.state.jugadorActivo.rotationQuaternion = Quaternion.FromEulerAngles(0, (this.motor3d.playerCameraFPS as any).rotation.y, 0);
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
    this.velocidadY = -0.1;
    this.highestY = -9999;
    this.idleTime = 0;
    this.state.mirandoObjetoInteractuable.set(false);
    this.playAnim(this.animIdle, true);
  }

  private playAnim(anim: AnimationGroup | null, loop: boolean) {
    if (!anim) return;
    
    if (this.animActual === anim) {
        if (anim.isPlaying) return; 
        if (!loop) return; 
    }

    this.animacionesJugador.forEach(a => {
        if (a !== anim) {
            a.stop();
            a.reset();
        }
    });

    anim.reset(); 
    anim.play(loop);
    this.animActual = anim;
  }
}