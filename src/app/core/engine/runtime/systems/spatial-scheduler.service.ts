import { Injectable } from '@angular/core';
import { Vector3 } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class SpatialSchedulerService {
  private lastEvalTime = 0;
  private lastPos = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  
  private readonly TIME_THRESHOLD_MS = 150; 
  private readonly DIST_SQ_THRESHOLD = 4.0; 

  public shouldEvaluate(currentPos: Vector3, dtMs: number): boolean {
    this.lastEvalTime += dtMs;
    
    if (this.lastEvalTime >= this.TIME_THRESHOLD_MS) {
      this.lastEvalTime = 0;
      this.lastPos.copyFrom(currentPos);
      return true;
    }

    if (Vector3.DistanceSquared(this.lastPos, currentPos) > this.DIST_SQ_THRESHOLD) {
      this.lastEvalTime = 0;
      this.lastPos.copyFrom(currentPos);
      return true;
    }

    return false;
  }

  public forceNextEvaluation(): void {
    this.lastEvalTime = this.TIME_THRESHOLD_MS;
  }

  public reset(): void {
    this.lastEvalTime = 0;
    this.lastPos.set(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  }
}