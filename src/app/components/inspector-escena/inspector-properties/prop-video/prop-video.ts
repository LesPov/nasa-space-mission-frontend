
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh, StandardMaterial, VideoTexture } from '@babylonjs/core';

@Component({
  selector: 'app-prop-video',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-video.html',
  styleUrls: ['../inspector-properties.css']
})
export class PropVideo {
  @Input() objeto!: AbstractMesh;

  get videoUrl() { return this.objeto?.metadata?.videoUrl || 'Ningún video cargado'; }

  playVideo() {
    this.getVideoTexture()?.video.play();
  }

  pauseVideo() {
    this.getVideoTexture()?.video.pause();
  }

  private getVideoTexture(): VideoTexture | null {
    if (!this.objeto || !this.objeto.material) return null;
    const mat = this.objeto.material as StandardMaterial;
    if (mat.diffuseTexture instanceof VideoTexture) {
      return mat.diffuseTexture;
    }
    return null;
  }
}
