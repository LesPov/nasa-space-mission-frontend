import { Component, OnDestroy, OnInit, inject, signal, ChangeDetectorRef, HostListener, effect } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MotorBabylon } from '../../../components/motor-babylon/motor-babylon';
import { InspectorEscena } from '../../../components/inspector-escena/inspector-escena';
import { ToolbarEscena } from '../../../components/toolbar-escena/toolbar-escena';
import { MiniVisorEscena } from '../../../components/mini-visor-escena/mini-visor-escena';
import { GlobalTimeline } from '../../../components/global-timeline/global-timeline';
import { UiHud } from '../../../components/ui-hud/ui-hud';
import { UiInspect } from '../../../components/ui-inspect/ui-inspect';
import { UiLoading } from '../../../components/ui-loading/ui-loading';
import { UiMission } from '../../../components/ui-mission/ui-mission';
import { UiRadialMenu } from '../../../components/ui-radial-menu/ui-radial-menu';
import { UiRoleSelectorComponent } from '../../../components/ui-role-selector/ui-role-selector'; 
 
import { EditorMapaService } from '../../../services/editor-mapa.service';
import { EditorStateService } from '../../../services/editor/editor-state.service';
import { EditorToolsService } from '../../../services/editor/editor-tools.service';
import { LayoutService } from '../../../services/layout.service';
import { GameSession } from '../../../core/engine/runtime/game-session';
import { EditorLayoutService } from '../../../services/editor/editor-layout.service';
import { EditorKeyboardService } from '../../../services/editor/editor-keyboard.service';
import { InputOrchestratorService } from '../../../core/engine/runtime/systems/input-orchestrator.service';
import { AddObjectModalService } from '../../../services/editor/modals/add-object-modal.service';
import { MissionModalService } from '../../../services/editor/modals/mission-modal.service';
import { RoleModalService } from '../../../services/editor/modals/role-modal.service'; 
import { AuthService } from '../../../core/services/auth';
import { GameContextService } from '../../../core/engine/session/game-context.service'; 
import { EditorOrchestratorService } from '../../../services/editor/editor-orchestrator.service';
import { RuntimeEngineService } from '../../../core/engine/runtime/runtime-engine.service';
import { InputRouterService } from '../../../core/engine/session/input-router.service';
import { Subscription } from 'rxjs';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { PlayerInputService } from '../../../core/engine/runtime/systems/player-input.service';
import { LiveBuilderService } from '../../../services/editor/live-builder.service';
import { Ubicacion3D } from '../ubicacion-3d/ubicacion3d';
import { NarrativeRoleDto } from '../../../core/engine/models/api-dto.model';
import { EditorModeTransitionService } from '../../../services/editor/editor-mode-transition.service';
 
@Component({
  selector: 'app-editor-escena', 
  standalone: true,
  imports: [
    MotorBabylon, InspectorEscena, ToolbarEscena, CommonModule, FormsModule,
    MiniVisorEscena, GlobalTimeline, UiHud, UiInspect, UiLoading, UiMission, UiRadialMenu, Ubicacion3D, UiRoleSelectorComponent 
  ],
  templateUrl: './editor-escena.html',
  styleUrl: './editor-escena.css', 
})
export class EditorEscena implements OnInit, OnDestroy {
  public orchestrator = inject(EditorOrchestratorService);
  public stateSvc = inject(EditorStateService);
  public editorSvc = inject(EditorMapaService); 
  public layoutSvc = inject(LayoutService);
  public gameSession = inject(GameSession);
  public layoutUI = inject(EditorLayoutService);
  public keyboard = inject(EditorKeyboardService);
  public inputOrchestrator = inject(InputOrchestratorService);
  public addObjSvc = inject(AddObjectModalService);
  public missionSvc = inject(MissionModalService);
  public roleModalSvc = inject(RoleModalService); 
  public authSvc = inject(AuthService);
  private gameContext = inject(GameContextService); 
  public cdr = inject(ChangeDetectorRef);
  private router = inject(Router);
  public toolsSvc = inject(EditorToolsService);
  public runtime = inject(RuntimeEngineService);
  private inputRouter = inject(InputRouterService);
  private eventBus = inject(GameEventBusService);
  public inputSvc = inject(PlayerInputService);
  private liveBuilderSvc = inject(LiveBuilderService);
  private transitionSvc = inject(EditorModeTransitionService);

  public isInteracting = signal(false);
  private kbSub!: Subscription;
  private ebSub!: Subscription;

  public get esAdmin(): boolean {
    return this.authSvc.isAdmin();
  }

  get editando() { return this.orchestrator.editando(); }
  get isPlayable() { return this.orchestrator.isPlayable(); }
  get cargandoEscena() { return this.orchestrator.cargandoEscena(); }
  get cargandoTexto() { return this.orchestrator.cargandoTexto(); }
  get fps() { return this.orchestrator.fps(); }
  get estadoGuardado() { return this.orchestrator.estadoGuardado(); }
  get listaEpisodios() { return this.orchestrator.listaEpisodios(); }
  get episodioCompletoData() { return this.orchestrator.episodioCompletoData; }
  set episodioCompletoData(v) { this.orchestrator.episodioCompletoData = v; }

  public mostrarModalMisionPreview = false;
  public cerrandoModalMision = false; 
  public misionIniciada = false;

  public hoveredEpisodio: number | null = null;
  public plataformaActualId: number | null = null;
  public mostrandoCrearPlataforma = false;
  public nuevaPlataformaNombre = '';
  public vistaPrueba: 'FPS' | 'TPS' = 'FPS';

  get objNombre() { return this.addObjSvc.objNombre; } set objNombre(v) { this.addObjSvc.objNombre = v; }
  get objTipo() { return this.addObjSvc.objTipo; } set objTipo(v) { this.addObjSvc.objTipo = v; }
  get objRol() { return this.addObjSvc.objRol; } set objRol(v) { this.addObjSvc.objRol = v; }
  get objColor() { return this.addObjSvc.objColor; } set objColor(v) { this.addObjSvc.objColor = v; }
  get objSizeX() { return this.addObjSvc.objSizeX; } set objSizeX(v) { this.addObjSvc.objSizeX = v; }
  get objSizeY() { return this.addObjSvc.objSizeY; } set objSizeY(v) { this.addObjSvc.objSizeY = v; }
  get objSizeZ() { return this.addObjSvc.objSizeZ; } set objSizeZ(v) { this.addObjSvc.objSizeZ = v; }
  get objAssetSeleccionado() { return this.addObjSvc.objAssetSeleccionado; } set objAssetSeleccionado(v) { this.addObjSvc.objAssetSeleccionado = v; }
  get objEsSolido() { return this.addObjSvc.objEsSolido; } set objEsSolido(v) { this.addObjSvc.objEsSolido = v; }
  get objEsSeleccionable() { return this.addObjSvc.objEsSeleccionable; } set objEsSeleccionable(v) { this.addObjSvc.objEsSeleccionable = v; }
  get objMensaje() { return this.addObjSvc.objMensaje; } set objMensaje(v) { this.addObjSvc.objMensaje = v; }
  get objHacerHijo() { return this.addObjSvc.objHacerHijo; } set objHacerHijo(v) { this.addObjSvc.objHacerHijo = v; }
  get listaAssets() { return this.addObjSvc.listaAssets; }
  get archivoSubida() { return this.addObjSvc.archivoSubida; } set archivoSubida(v) { this.addObjSvc.archivoSubida = v; }
  get subiendoAsset() { return this.addObjSvc.subiendoAsset; }

  constructor() {
    effect(() => {
      this.stateSvc.playState();
    });
  }

  ngOnInit() {
    this.gameContext.setupContext('EDITOR', { submode: 'EDITING', cameraView: 'FPS' }); 
    this.addObjSvc.cargarAssets();
    if (this.esAdmin) {
      this.orchestrator.initialize();
    }
    
    this.keyboard.init();
    this.kbSub = this.inputRouter.getGlobalKeyboardStream(['UI', 'EDITOR_EDITING', 'EDITOR_PLAYTEST']).subscribe(e => {
      this.manejarAtajos(e);
    });

    this.ebSub = this.eventBus.events$.subscribe(event => {
      if (event.type === 'GamePaused') {
        setTimeout(() => {
          // Solo abrir el modal si el estado actual es genuinamente PLAYING y no estamos saliendo al Editor
          if (
            this.misionIniciada && 
            !this.cerrandoModalMision && 
            this.stateSvc.playState() === 'PLAYING' &&
            !this.transitionSvc.isExitingPlayMode()
          ) {
            if (
              !this.inputSvc.isRadialMenuOpen && 
              !this.liveBuilderSvc.isBuilding() && 
              !this.gameContext.isPointerLocked() && 
              !this.roleModalSvc.showRoleSelector()
            ) {
              this.mostrarModalMisionPreview = true;
              this.cdr.detectChanges();
            }
          }
        }, 150);
      }
    });
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) { this.layoutUI.onMouseMove(event); }

  @HostListener('window:mouseup')
  onMouseUp() { this.layoutUI.onMouseUp(); }

  manejarAtajos(event: KeyboardEvent) { 
    if (event.key === 'Escape') {
      if (this.mostrarModalMisionPreview) return;
      
      if (this.stateSvc.previewMissionModal()) {
        this.stateSvc.setPreviewMissionModal(false);
        this.cdr.detectChanges();
        return;
      }
      
      if (
        this.misionIniciada && 
        !this.mostrarModalMisionPreview && 
        this.stateSvc.playState() === 'PLAYING' && 
        !this.transitionSvc.isExitingPlayMode()
      ) {
        if (this.inputSvc.isRadialMenuOpen || this.liveBuilderSvc.isBuilding() || this.roleModalSvc.showRoleSelector()) return;

        if (this.gameContext.isPointerLocked()) {
          this.inputOrchestrator.unlockPointer();
        } else {
          this.eventBus.emit({ type: 'GamePaused' });
        }
      }
    }
  }

  toggleNieblaTemporal() {
    this.stateSvc.setFogDesactivadoTemporalmente(!this.stateSvc.fogDesactivadoTemporalmente());
    setTimeout(() => window.dispatchEvent(new Event('resize')), 10);
    this.editorSvc.onMapChanged.next();
  }

  togglePreviewMission() {
    const state = this.stateSvc.playState();
    if (state === 'EDITING_IN_GAME' || state === 'PLAYING') {
      this.mostrarModalMisionPreview = !this.mostrarModalMisionPreview;
    } else {
      this.stateSvc.setPreviewMissionModal(!this.stateSvc.previewMissionModal());
    }
  }

  jugarModoFinal(episodio: any) {
    this.router.navigate(['/jugador/jugar', episodio.initialScene?.id || episodio.id]);
  }

  entrarAlEditor(episodio: any) {
    this.plataformaActualId = episodio.initialScene?.id || episodio.id;
    this.orchestrator.entrarAlEditor(episodio);
  }

  abrirModalCrearPlataforma() {
    this.nuevaPlataformaNombre = '';
    this.mostrandoCrearPlataforma = true;
  }

  confirmarCrearPlataforma() {
    this.orchestrator.confirmarCrearPlataforma(this.nuevaPlataformaNombre);
    this.mostrandoCrearPlataforma = false;
  }

  cambiarPlataformaActiva() {
    if (!this.plataformaActualId) return;
    this.orchestrator.cambiarPlataformaActiva(this.plataformaActualId);
  }

  onCanvasClick() {
    if (
      this.stateSvc.playState() === 'PLAYING' && 
      !this.gameSession.pointerLocked() && 
      !this.isInteracting() && 
      !this.mostrarModalMisionPreview && 
      !this.transitionSvc.isExitingPlayMode()
    ) {
      if (!this.inputSvc.isRadialMenuOpen && !this.roleModalSvc.showRoleSelector()) {
        this.inputOrchestrator.lockPointer();
      }
    }
  }

  seleccionarArchivoSubida(event: any) { this.addObjSvc.seleccionarArchivoSubida(event); }
  subirNuevoAsset() { this.addObjSvc.subirNuevoAsset(() => this.cdr.detectChanges()); }
  onRolChange() { this.addObjSvc.onRolChange(); }
  onTipoChange() { this.addObjSvc.onTipoChange(); }
  crearObjeto3D() { this.addObjSvc.crearObjeto3D(); }
  cerrarModalObjeto() { this.addObjSvc.cerrarModalObjeto(); }

  crearNuevoEpisodio() {
    this.orchestrator.crearNuevoEpisodio(this.missionSvc.newMapTitle, this.missionSvc.newMapDesc);
  }

  guardarMapaEnBD(silencioso = false) {
    this.orchestrator.guardarMapaEnBD(silencioso);
  }

  abrirVentanaPreview() {
    this.orchestrator.abrirVentanaPreview();
  }

  handleAdminPlayClick() {
    const roles = this.editorSvc.episodioActualData()?.narrativeRoles || [];
    const playableRoles = roles.filter((r: NarrativeRoleDto) => r.isEnabled && r.isPlayable);

    if (playableRoles.length > 0) {
      this.roleModalSvc.openSelector(playableRoles, (uid) => {
        this.iniciarModoPrueba(uid);
      });
    } else {
      this.iniciarModoPrueba();
    }
  }

  iniciarModoPrueba(roleUid?: string) {
    this.mostrarModalMisionPreview = false;
    this.misionIniciada = true;
    this.orchestrator.getGameState().setPlayerRole(roleUid || '');
    this.orchestrator.iniciarModoPrueba(this.vistaPrueba, false, roleUid);
    this.inputOrchestrator.lockPointer();
  }

  comenzarMisionPreview() {
    this.cerrandoModalMision = true;
    this.inputOrchestrator.lockPointer();

    setTimeout(() => {
      this.misionIniciada = true; 
      this.mostrarModalMisionPreview = false;
      this.cerrandoModalMision = false;
      this.cdr.detectChanges(); 
    }, 300); 
  }

  handleMissionStart() {
    if (this.stateSvc.previewMissionModal() && !this.mostrarModalMisionPreview) {
      this.stateSvc.setPreviewMissionModal(false);
    } else {
      const currentRole = this.orchestrator.getGameState().playerRole;
      const roles = this.editorSvc.episodioActualData()?.narrativeRoles || [];
      const playableRoles = roles.filter((r: NarrativeRoleDto) => r.isEnabled && r.isPlayable);

      if (!currentRole && playableRoles.length > 0) {
        this.roleModalSvc.openSelector(playableRoles, (uid) => {
          this.orchestrator.getGameState().setPlayerRole(uid);
          this.comenzarMisionPreview();
        });
      } else {
        this.comenzarMisionPreview();
      }
    }
  }

  handleMissionExit() {
    if (this.stateSvc.previewMissionModal() && !this.mostrarModalMisionPreview) {
      this.stateSvc.setPreviewMissionModal(false);
    } else {
      this.detenerModoPrueba();
    }
  }

  async detenerModoPrueba() {
    this.mostrarModalMisionPreview = false;
    this.misionIniciada = false;
    this.roleModalSvc.showRoleSelector.set(false);
    await this.orchestrator.detenerModoPrueba();
  }

  cerrarInteraccion() {
    this.runtime.cerrarInteraccion();
  }

  salirDelEditor() {
    this.orchestrator.salirDelEditor();
    this.isInteracting.set(false);
  }

  ngOnDestroy(): void {
    this.keyboard.dispose();
    if (this.kbSub) this.kbSub.unsubscribe();
    if (this.ebSub) this.ebSub.unsubscribe();
    this.orchestrator.destroy();
  }
}