
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ShadowCache {
  public metrics = {
    invalidations: 0,
    renderListRebuilds: 0,
    staticLights: 0,
    dynamicLights: 0
  };

  public recordInvalidation() {
    this.metrics.invalidations++;
  }

  public recordRebuild() {
    this.metrics.renderListRebuilds++;
  }

  public setLightDistribution(staticCount: number, dynamicCount: number) {
    this.metrics.staticLights = staticCount;
    this.metrics.dynamicLights = dynamicCount;
  }

  public clearMetrics() {
    this.metrics.invalidations = 0;
    this.metrics.renderListRebuilds = 0;
  }
} 