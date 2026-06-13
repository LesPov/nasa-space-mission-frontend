
import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef, SimpleChanges, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, AnimationGroup } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EditorPlayerService } from '../../../../services/editor/editor-player.service';
import { PlayerActionKey, PlayerRuntimeConfig, cloneDefaultPlayerConfig, mergePlayerConfig, normalizeAnimBinding } from '../../../../services/editor/player-config.model';
import { Motor3dService } from '../../../../services/motor-3d.service';

interface ActionRow { key: PlayerActionKey; label: string; family: string; keywords: string[]; help: string; }
interface ClipViewModel { name: string; group: AnimationGroup; targetCount: number; speedRatio: number; loop: boolean; playing: boolean; }

@Component({
  selector: 'app-prop-animation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-animation.html',
  styleUrls: ['../inspector-properties.css']
})
export class PropAnimation implements OnInit, OnDestroy, OnChanges {
  @Input() objeto!: AbstractMesh;
  
  private editorSvc = inject(EditorMapaService);
  private motor3dSvc = inject(Motor3dService);
  private playerSvc = inject(EditorPlayerService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  public playerConfig: PlayerRuntimeConfig = cloneDefaultPlayerConfig();
  
  public actionRows: ActionRow[] = [
    { key: 'idle', label: 'Animación Base (Idle)', family: 'Base', keywords: ['idle', 'scene', 'base', 'anim'], help: 'Animación constante' }
  ];

  public bindingInputs: Record<PlayerActionKey, string> = this.emptyBindingInputs();
  public bindingTokens: Record<PlayerActionKey, string[]> = this.emptyBindingTokens();

  public animationClips: ClipViewModel[] = [];
  public clipFilter = '';
  public animStatus = '';

  ngOnInit() {
    this.ajustarFilasSegunTipo();
    this.syncData();
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => {
        this.ajustarFilasSegunTipo();
        this.syncData();
      })
    );
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['objeto']) {
      this.ajustarFilasSegunTipo();
      this.syncData();
    }
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.detenerAnimaciones();
  }

  private ajustarFilasSegunTipo() {
      const isChar = this.objeto?.metadata?.rol === 'npc' || this.objeto?.metadata?.rol === 'spawn_point';
      if (isChar) {
          this.actionRows = [
            { key: 'idle', label: 'Idle / Reposo', family: 'Base', keywords: ['idle'], help: '' },
            { key: 'walk', label: 'Walk', family: 'Movimiento base', keywords: ['walk'], help: '' },
            { key: 'run', label: 'Run', family: 'Movimiento base', keywords: ['run'], help: '' },
            { key: 'jumpStart', label: 'Jump Start', family: 'Aire', keywords: ['jump'], help: '' },
            { key: 'jumpLoop', label: 'Jump Loop', family: 'Aire', keywords: ['fall'], help: '' }
          ];
      } else {
          this.actionRows = [
            { key: 'idle', label: 'Animación Base Continua', family: 'Base', keywords: ['scene', 'idle'], help: '' }
          ];
      }
      this.bindingInputs = this.emptyBindingInputs();
      this.bindingTokens = this.emptyBindingTokens();
  }

  private emptyBindingInputs(): Record<PlayerActionKey, string> { return this.actionRows.reduce((acc, row) => { acc[row.key] = ''; return acc; }, {} as Record<PlayerActionKey, string>); }
  private emptyBindingTokens(): Record<PlayerActionKey, string[]> { return this.actionRows.reduce((acc, row) => { acc[row.key] = []; return acc; }, {} as Record<PlayerActionKey, string[]>); }

  syncData() {
    if (!this.objeto) return;
    const meta = this.objeto.metadata || {};
    this.playerConfig = mergePlayerConfig(meta.playerConfig || null);
    
    this.syncBindingDraftsFromConfig();
    this.syncClipsFromObject(this.objeto);
    
    this.animStatus = 'Animaciones del modelo cargadas.';
    this.cdr.detectChanges();
  }

  private getAvailableAnimationGroups(obj: AbstractMesh): AnimationGroup[] {
    const scene = this.motor3dSvc.scene;
    
    const validTargets = new Set();
    validTargets.add(obj);
    obj.getDescendants(false).forEach(child => validTargets.add(child));

    let myAnimNames: string[] = obj.metadata?.animationNames || [];
    
    if (myAnimNames.length === 0) {
        const childWithAnims = obj.getChildMeshes(false).find(m => m.metadata?.animationNames && m.metadata.animationNames.length > 0);
        if (childWithAnims) {
            myAnimNames = childWithAnims.metadata.animationNames;
        }
    }
    
    if (myAnimNames.length > 0) {
         let matchedGroups = scene.animationGroups.filter(ag => myAnimNames.includes(ag.name));
         if (matchedGroups.length > 0) return matchedGroups;
    }

    let groups = scene.animationGroups.filter((ag: AnimationGroup) => {
      if (!ag.targetedAnimations || ag.targetedAnimations.length === 0) return false;
      return ag.targetedAnimations.some((ta: any) => validTargets.has(ta.target));
    });

    return groups;
  }

  private syncBindingDraftsFromConfig() {
    for (const action of this.actionRows) {
      const value = this.playerConfig.animations[action.key];
      const tokens = normalizeAnimBinding(value);
      this.bindingTokens[action.key] = [...tokens];
      this.bindingInputs[action.key] = tokens.join(', ');
    }
  }

  private syncClipsFromObject(obj: AbstractMesh) {
    const metaRuntime = obj.metadata?.playerConfig?.animationRuntime || {};
    const groups = this.getAvailableAnimationGroups(obj);
    
    // Quitar duplicados por nombre de la lista de visualización
    const uniqueGroups = groups.filter((v, i, a) => a.findIndex(t => (t.name === v.name)) === i);
    
    this.animationClips = uniqueGroups.map(group => {
      const runtime = metaRuntime?.[group.name] || {};
      const speedRatio = typeof runtime.speedRatio === 'number' ? runtime.speedRatio : (group.speedRatio ?? 1);
      const loop = typeof runtime.loop === 'boolean' ? runtime.loop : true;
      group.speedRatio = speedRatio;
      return { name: group.name, group, targetCount: group.targetedAnimations?.length ?? 0, speedRatio, loop, playing: !!group.isPlaying };
    });
  }

  private persistPlayerConfig() {
    if (!this.objeto.metadata) this.objeto.metadata = {};
    this.objeto.metadata.playerConfig = JSON.parse(JSON.stringify(this.playerConfig));
    this.objeto.metadata.animationNames = this.animationClips.map(c => c.name);
    
    // 🔥 FIX: Resincronizar en vivo si el juego está corriendo y se cambia la animación base
    if (this.editorSvc.playState() === 'EDITING_IN_GAME') {
       this.playerSvc.resincronizarAnimaciones(this.objeto);
    }
    
    this.editorSvc.triggerUpdate();
  }

  private normalizeList(raw: string): string[] { return raw.split(',').map(v => v.trim()).filter(Boolean); }

  agregarBinding(actionKey: PlayerActionKey) {
    const raw = (this.bindingInputs[actionKey] || '').trim(); if (!raw) return;
    const incoming = this.normalizeList(raw);
    const current = new Set(this.bindingTokens[actionKey] || []);
    for (const token of incoming) current.add(token);
    this.bindingTokens[actionKey] = Array.from(current);
    this.bindingInputs[actionKey] = '';
    this.playerConfig.animations[actionKey] = this.bindingTokens[actionKey].length > 0 ? [...this.bindingTokens[actionKey]] : null;
    this.persistPlayerConfig();
    this.animStatus = `Asignado a ${actionKey}`;
  }

  quitarBinding(actionKey: PlayerActionKey, index: number) {
    const tokens = [...(this.bindingTokens[actionKey] || [])];
    tokens.splice(index, 1);
    this.bindingTokens[actionKey] = tokens;
    this.playerConfig.animations[actionKey] = tokens.length > 0 ? [...tokens] : null;
    this.persistPlayerConfig();
  }

  detectarBindingsAutomaticamente() {
    for (const action of this.actionRows) {
      const current = new Set(this.bindingTokens[action.key] || []);
      for (const clip of this.animationClips) {
        const name = clip.name.toLowerCase();
        const match = action.key === 'idle' ? ['scene', 'idle', 'anim', 'action'] : [action.key];
        
        if (match.some(term => name.includes(term)) || this.animationClips.length === 1) {
            current.add(clip.name);
        }
      }
      this.bindingTokens[action.key] = Array.from(current);
      this.playerConfig.animations[action.key] = this.bindingTokens[action.key].length > 0 ? [...this.bindingTokens[action.key]] : null;
    }
    this.persistPlayerConfig();
    this.animStatus = 'Detección automática lista';
  }

  reproducirAnimacion(anim: AnimationGroup) { 
    this.detenerAnimaciones(); 
    this.playerSvc.detenerPreviewSecuencia(); 
    anim.reset(); 
    anim.play(true); 
    this.animStatus = `Reproduciendo: ${anim.name}`; 
  }
  
  detenerAnimaciones() { 
    for (const clip of this.animationClips) { 
        clip.group.stop(); 
        clip.playing = false; 
    } 
    this.playerSvc.detenerPreviewSecuencia(); 
    this.animStatus = 'Animación detenida'; 
  }
  
  refreshClipPlayingFlags() { 
      for (const clip of this.animationClips) { 
          clip.playing = !!clip.group.isPlaying; 
      } 
  }
  
  get animationClipsFiltradas(): ClipViewModel[] { 
      const q = this.clipFilter.trim().toLowerCase(); 
      this.refreshClipPlayingFlags(); 
      if (!q) return this.animationClips; 
      return this.animationClips.filter(c => c.name.toLowerCase().includes(q)); 
  }
  
  actionBadge(actionKey: PlayerActionKey): string { 
      const tokens = this.bindingTokens[actionKey] || []; 
      return tokens.length ? `Asignado` : 'vacío'; 
  }
}
