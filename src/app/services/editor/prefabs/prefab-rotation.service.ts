
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PrefabRotationService {
  public yaw = 0;
  public pitch = 0;
  public roll = 0;
  public heightOffset = 0;

  public rotateY(degrees: number) { this.yaw += degrees; }
  public rotateX(degrees: number) { this.pitch += degrees; }
  public rotateZ(degrees: number) { this.roll += degrees; }
  public changeHeight(amount: number) { this.heightOffset += amount; }

  public reset() {
    this.yaw = 0; 
    this.pitch = 0; 
    this.roll = 0; 
    this.heightOffset = 0;
  }
}
