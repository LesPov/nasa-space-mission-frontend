
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ui-loading',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-loading.html',
  styleUrls: ['./ui-loading.css']
})
export class UiLoading {
  @Input() texto = 'Cargando...';
}