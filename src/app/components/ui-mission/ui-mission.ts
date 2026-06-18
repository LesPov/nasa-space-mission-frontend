
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ui-mission',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-mission.html',
  styleUrls: ['./ui-mission.css']
})
export class UiMission {
  @Input() mapaNombre = '';
  @Input() misionIniciada = false;
  @Input() cerrando = false;
  @Input() isAdmin = false;

  @Output() onStart = new EventEmitter<void>();
  @Output() onExit = new EventEmitter<void>();
}