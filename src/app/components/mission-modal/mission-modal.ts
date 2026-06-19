import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-mission-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mission-modal.html',
  styleUrls: ['./mission-modal.css']
})
export class MissionModalComponent implements OnInit {
  @Input() mode: 'create' | 'edit' = 'create';
  @Input() initialData: any = null;

  @Output() onSave = new EventEmitter<any>();
  @Output() onCancel = new EventEmitter<void>();

  public activeTab: string = 'general';

  public formData = {
    title: '',
    description: '',
    initialSequence: '',
    loreQuote: '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."',
    loreAuthor: 'Anónimo',
    objetivos: ['Explora el área y analiza los elementos clave.'],
    recompensas: [] as string[],
    
    // Apariencia y Glassmorphism
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
    if (this.mode === 'edit' && this.initialData) {
      this.formData = { ...this.formData, ...this.initialData };
      if (!this.formData.objetivos || !Array.isArray(this.formData.objetivos)) {
        this.formData.objetivos = [];
      }
      if (!this.formData.recompensas || !Array.isArray(this.formData.recompensas)) {
        this.formData.recompensas = [];
      }
    }
  }

  trackByIndex(index: number, obj: any): any {
    return index;
  }

  addObjective() { this.formData.objetivos.push('Nuevo objetivo...'); }
  removeObjective(i: number) { this.formData.objetivos.splice(i, 1); }

  addReward() { this.formData.recompensas.push('Nueva recompensa...'); }
  removeReward(i: number) { this.formData.recompensas.splice(i, 1); }

  save() {
    if (!this.formData.title.trim()) {
      alert('El título de la misión es obligatorio.');
      return;
    }
    this.onSave.emit(this.formData);
  }

  cancel() {
    this.onCancel.emit();
  }
}