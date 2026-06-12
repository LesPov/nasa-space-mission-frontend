import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
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

const ACTION_ROWS: ActionRow[] = [
  { key: 'idle', label: 'Idle', family: 'Movimiento base', keywords: ['idle'], help: 'Reposo / espera' },
  { key: 'walk', label: 'Walk', family: 'Movimiento base', keywords: ['walk'], help: 'Caminar' },
  { key: 'run', label: 'Run', family: 'Movimiento base', keywords: ['run'], help: 'Correr' },
  { key: 'jumpStart', label: 'Jump Start', family: 'Aire', keywords: ['jump start', 'jump_begin', 'jump'], help: 'Inicio del salto' },
  { key: 'jumpLoop', label: 'Jump Loop', family: 'Aire', keywords: ['jump loop', 'jump'], help: 'Fase en el aire' },
  { key: 'fall', label: 'Fall', family: 'Aire', keywords: ['fall', 'falling'], help: 'Caída' },
  { key: 'landSoft', label: 'Land Soft', family: 'Aire', keywords: ['land', 'soft landing'], help: 'Aterrizaje suave' },
  { key: 'landHard', label: 'Land Hard', family: 'Aire', keywords: ['hard landing'], help: 'Aterrizaje fuerte' },
  { key: 'recover', label: 'Recover', family: 'Aire', keywords: ['recover', 'recovery'], help: 'Recuperación' },
  { key: 'climbUp', label: 'Climb Up', family: 'Escalada', keywords: ['climb up', 'climb'], help: 'Subida inicial' },
  { key: 'hangIdle', label: 'Hang Idle', family: 'Escalada', keywords: ['hang idle', 'hang'], help: 'Colgado del borde' },
  { key: 'climbFinish', label: 'Climb Finish', family: 'Escalada', keywords: ['climb finish', 'pull up'], help: 'Terminar de subir' },
  { key: 'vault', label: 'Vault', family: 'Escalada', keywords: ['vault'], help: 'Impulso / salto corto' },
  { key: 'stepUp', label: 'Step Up', family: 'Escalada', keywords: ['step up', 'step'], help: 'Subir escalón' }
];

@Component({
  selector: 'app-prop-animation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-animation.html',
  styleUrls: ['../inspector-properties.css']
})
export class PropAnimation implements OnInit, OnDestroy {
  @Input() objeto!: AbstractMesh;
  
  private editorSvc = inject(EditorMapaService);
  private motor3dSvc = inject(Motor3dService);
  private playerSvc = inject(EditorPlayerService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  public playerConfig: PlayerRuntimeConfig = cloneDefaultPlayerConfig();
  public actionRows: ActionRow[] = ACTION_ROWS;

  public bindingInputs: Record<PlayerActionKey, string> = this.emptyBindingInputs();
  public bindingTokens: Record<PlayerActionKey, string[]> = this.emptyBindingTokens();

  public animationClips: ClipViewModel[] = [];
  public clipFilter = '';
  public animStatus = '';

  ngOnInit() {
    this.syncData();
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => this.syncData())
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.detenerAnimaciones();
  }

  private emptyBindingInputs(): Record<PlayerActionKey, string> { return ACTION_ROWS.reduce((acc, row) => { acc[row.key] = ''; return acc; }, {} as Record<PlayerActionKey, string>); }
  private emptyBindingTokens(): Record<PlayerActionKey, string[]> { return ACTION_ROWS.reduce((acc, row) => { acc[row.key] = []; return acc; }, {} as Record<PlayerActionKey, string[]>); }

  syncData() {
    if (!this.objeto) return;
    const meta = this.objeto.metadata || {};
    this.playerConfig = mergePlayerConfig(meta.playerConfig || null);
    
    this.syncBindingDraftsFromConfig();
    this.syncClipsFromObject(this.objeto);
    
    this.animStatus = 'Cargado correctamente';
    this.cdr.detectChanges();
  }

  private getAvailableAnimationGroups(obj: AbstractMesh): AnimationGroup[] {
    const scene = this.motor3dSvc.scene;
    const names: string[] = Array.isArray(obj.metadata?.animationNames) ? obj.metadata.animationNames : [];
    let groups: AnimationGroup[] = [];
    if (names.length > 0) groups = scene.animationGroups.filter(ag => names.includes(ag.name));
    if (groups.length === 0) {
      groups = scene.animationGroups.filter((ag: AnimationGroup) => ag.targetedAnimations.some((ta: any) => ta.target === obj || ta.target?.parent === obj));
    }
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
    this.animationClips = groups.map(group => {
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
    this.animStatus = `Binding agregado a ${actionKey}`;
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
        const match =
          action.key === 'jumpStart' ? ['jump start', 'jump_begin', 'jump'] :
          action.key === 'jumpLoop' ? ['jump loop', 'jump'] :
          action.key === 'landHard' ? ['hard landing'] :
          action.key === 'landSoft' ? ['land', 'soft landing'] :
          action.key === 'climbUp' ? ['climb up', 'climb'] :
          action.key === 'climbFinish' ? ['climb finish', 'pull up'] :
          action.key === 'hangIdle' ? ['hang idle', 'hang'] :
          action.key === 'stepUp' ? ['step up', 'step'] :
          action.key === 'vault' ? ['vault'] : [action.key];
        if (match.some(term => name.includes(term))) current.add(clip.name);
      }
      this.bindingTokens[action.key] = Array.from(current);
      this.playerConfig.animations[action.key] = this.bindingTokens[action.key].length > 0 ? [...this.bindingTokens[action.key]] : null;
    }
    this.persistPlayerConfig();
    this.animStatus = 'Bindings detectados automáticamente';
  }

  reproducirAnimacion(anim: AnimationGroup) { 
    this.detenerAnimaciones(); 
    this.playerSvc.detenerPreviewSecuencia(); 
    anim.reset(); 
    anim.play(true); 
    this.animStatus = `Reproduciendo ${anim.name}`; 
  }
  
  detenerAnimaciones() { 
    for (const clip of this.animationClips) { 
        clip.group.stop(); 
        clip.playing = false; 
    } 
    this.playerSvc.detenerPreviewSecuencia(); 
    this.animStatus = 'Todas las animaciones detenidas'; 
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
      return tokens.length ? `activo · ${tokens.length}` : 'vacío'; 
  }
}