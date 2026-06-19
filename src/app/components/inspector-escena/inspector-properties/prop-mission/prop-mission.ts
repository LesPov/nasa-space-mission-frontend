import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { Motor3dService } from '../../../../services/motor-3d.service';
 
@Component({
  selector: 'app-prop-mission',
  standalone: true, 
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-mission.html',
  styleUrls: ['./prop-mission.css']
})
export class PropMission implements OnInit, OnDestroy {
  public editorSvc = inject(EditorMapaService);
  private motor3dSvc = inject(Motor3dService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  // Acordeones
  public acordeones: Record<string, boolean> = {
    general: true,
    objetivos: false,
    recompensas: false,
    apariencia: false,
    avanzado: false
  };

  public formData = {
    title: '',
    description: '',
    initialSequence: '',
    loreQuote: '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."',
    loreAuthor: 'Anónimo',
    objetivos: [] as string[],
    recompensas: [] as string[],
    
    primaryColor: '#ef4444',
    bgColor: '#0f172a',
    bgOpacity: 0.85,
    textColor: '#cbd5e1',
    overlayColor: '#050508',
    overlayOpacity: 0.7,
    blurIntensity: 8,
    borderRadius: 12,
    padding: 20,
    shadows: '0 20px 50px rgba(0,0,0,0.8)',
    maxWidth: 650
  };

  ngOnInit() {
    this.leerEstadoActual();
    // Escuchamos por si alguien editó el título directo en el Canvas
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => this.leerEstadoActual())
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  toggleAcordeon(seccion: string) {
    this.acordeones[seccion] = !this.acordeones[seccion];
  }

  trackByIndex(index: number, obj: any): any { return index; }

  addObjective() { this.formData.objetivos.push('Nuevo objetivo...'); this.aplicarCambios(); }
  removeObjective(i: number) { this.formData.objetivos.splice(i, 1); this.aplicarCambios(); }

  addReward() { this.formData.recompensas.push('Nueva recompensa...'); this.aplicarCambios(); }
  removeReward(i: number) { this.formData.recompensas.splice(i, 1); this.aplicarCambios(); }

  leerEstadoActual() {
    const dataEpi = this.editorSvc.episodioActualData() || {};
    const ui = this.motor3dSvc.scene?.metadata?.uiSettings || dataEpi.uiSettings || {};

    this.formData.title = dataEpi.title || '';
    this.formData.description = dataEpi.description || '';
    
    this.formData.primaryColor = ui.primaryColor || '#ef4444';
    this.formData.bgColor = ui.bgColor || '#0f172a';
    this.formData.bgOpacity = ui.bgOpacity ?? 0.85;
    this.formData.textColor = ui.textColor || '#cbd5e1';
    this.formData.loreQuote = ui.loreQuote || '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."';
    this.formData.loreAuthor = ui.loreAuthor || 'Anónimo';
    this.formData.initialSequence = ui.initialSequence || '';

    this.formData.overlayColor = ui.overlayColor || '#050508';
    this.formData.overlayOpacity = ui.overlayOpacity ?? 0.7;
    this.formData.blurIntensity = ui.blurIntensity ?? 8;
    this.formData.borderRadius = ui.borderRadius ?? 12;
    this.formData.padding = ui.padding ?? 20;
    this.formData.maxWidth = ui.maxWidth ?? 650;
    this.formData.shadows = ui.shadows || '0 20px 50px rgba(0,0,0,0.8)';

    this.formData.objetivos = Array.isArray(ui.objetivos) ? [...ui.objetivos] : ['Explora el área y analiza los elementos clave.'];
    this.formData.recompensas = Array.isArray(ui.recompensas) ? [...ui.recompensas] : [];

    this.cdr.detectChanges();
  }

  aplicarCambios() {
    const dataEpi = this.editorSvc.episodioActualData() || {};
    dataEpi.title = this.formData.title;
    dataEpi.description = this.formData.description;

    const scene = this.motor3dSvc.scene;
    if (scene) {
      scene.metadata = { 
        ...(scene.metadata || {}), 
        uiSettings: JSON.parse(JSON.stringify(this.formData)) 
      };
    }

    // Inyectamos de vuelta al Signal para que todos se enteren
    this.editorSvc.episodioActualData.set(dataEpi);
    this.editorSvc.triggerUpdate(); // Obliga a Angular/Babylon a renderizar
  }
}