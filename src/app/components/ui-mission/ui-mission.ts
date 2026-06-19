// src/app/components/ui-mission/ui-mission.ts

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // 🔥 Se requiere para edición 2-way data binding

@Component({
  selector: 'app-ui-mission',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ui-mission.html',
  styleUrls: ['./ui-mission.css']
})
export class UiMission {
  @Input() mapaNombre = '';
  @Input() misionIniciada = false;
  @Input() cerrando = false;
  @Input() isDebugMode = false;

  @Output() onStart = new EventEmitter<void>();
  @Output() onExit = new EventEmitter<void>();
  
  // 🔥 Nuevo evento para emitir cambios de edición en modo Creador
  @Output() mapaNombreChange = new EventEmitter<string>();
}