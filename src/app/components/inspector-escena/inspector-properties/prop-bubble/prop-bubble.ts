import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractMesh } from '@babylonjs/core';

@Component({
  selector: 'app-prop-bubble',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './prop-bubble.html',
  styleUrls: ['../inspector-properties.css']
})
export class PropBubble {
  @Input() objeto!: AbstractMesh;
}