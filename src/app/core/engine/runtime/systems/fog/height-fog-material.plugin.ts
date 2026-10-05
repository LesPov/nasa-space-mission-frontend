import { 
  MaterialPluginBase, Material, Scene, SubMesh, 
  UniformBuffer, Color3, Vector3, Nullable, ShaderLanguage 
} from '@babylonjs/core';

export class HeightFogMaterialPlugin extends MaterialPluginBase {
  public static readonly PLUGIN_NAME = 'HeightFogMaterialPlugin';

  public static fogColor: Color3 = new Color3(0, 0, 0);
  public static groundY = 0.0;
  public static fogHeight = 15.0;
  public static fogStart = 15.0;
  public static fogEnd = 100.0;
  public static maxDensity = 1.0;
  public static heightFalloff = 1.6;
  public static isFogActive = false;
  public static cameraPosition: Vector3 = new Vector3(0, 0, 0);

  public isEnabled = true;

  constructor(material: Material) {
    const existing = (material as any).getPlugin?.(HeightFogMaterialPlugin.PLUGIN_NAME);
    if (existing) {
      return existing;
    }

    super(material, HeightFogMaterialPlugin.PLUGIN_NAME, 200, {
      'CUSTOM_HEIGHT_FOG': false
    });
    this.setEnabled(true);
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this._enable(enabled);
  }

  public override getClassName(): string {
    return 'HeightFogMaterialPlugin';
  }

  public override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  public override prepareDefines(defines: any, scene: Scene, mesh: any): void {
    const isMaterialFogEnabled = (this._material as any).fogEnabled !== false;
    defines.CUSTOM_HEIGHT_FOG = this.isEnabled && isMaterialFogEnabled;
    defines.NEED_WORLDPOSITION = true;
  }

  public override getUniforms(): { ubo?: Array<{ name: string; size: number; type: string }>; globals?: string; vertex?: string; fragment?: string } {
    return {
      ubo: [
        { name: 'uCustomHeightFogColor', size: 3, type: 'vec3' },
        { name: 'uCustomHeightFogParams', size: 4, type: 'vec4' },
        { name: 'uCustomHeightFogControls', size: 4, type: 'vec4' },
        { name: 'uCustomHeightFogCamPos', size: 3, type: 'vec3' }
      ],
      fragment: `
        #ifndef CUSTOM_HEIGHT_FOG_UNIFORMS_DEFINED
        #define CUSTOM_HEIGHT_FOG_UNIFORMS_DEFINED
        uniform vec3 uCustomHeightFogColor;
        uniform vec4 uCustomHeightFogParams;
        uniform vec4 uCustomHeightFogControls;
        uniform vec3 uCustomHeightFogCamPos;
        #endif
      `
    };
  }

  public override bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene, engine: any, subMesh: SubMesh): void {
    if (!this.isEnabled) return;

    if (uniformBuffer.isSync) {
      uniformBuffer.updateColor3('uCustomHeightFogColor', HeightFogMaterialPlugin.fogColor);
      uniformBuffer.updateFloat4(
        'uCustomHeightFogParams',
        HeightFogMaterialPlugin.groundY,
        HeightFogMaterialPlugin.fogHeight,
        HeightFogMaterialPlugin.fogStart,
        HeightFogMaterialPlugin.fogEnd
      );
      uniformBuffer.updateFloat4(
        'uCustomHeightFogControls',
        HeightFogMaterialPlugin.maxDensity,
        HeightFogMaterialPlugin.heightFalloff,
        1.0,
        HeightFogMaterialPlugin.isFogActive ? 1.0 : 0.0
      );
      uniformBuffer.updateVector3('uCustomHeightFogCamPos', HeightFogMaterialPlugin.cameraPosition);
    } else {
      const effect = subMesh.effect;
      if (effect) {
        effect.setColor3('uCustomHeightFogColor', HeightFogMaterialPlugin.fogColor);
        effect.setFloat4(
          'uCustomHeightFogParams',
          HeightFogMaterialPlugin.groundY,
          HeightFogMaterialPlugin.fogHeight,
          HeightFogMaterialPlugin.fogStart,
          HeightFogMaterialPlugin.fogEnd
        );
        effect.setFloat4(
          'uCustomHeightFogControls',
          HeightFogMaterialPlugin.maxDensity,
          HeightFogMaterialPlugin.heightFalloff,
          1.0,
          HeightFogMaterialPlugin.isFogActive ? 1.0 : 0.0
        );
        effect.setVector3('uCustomHeightFogCamPos', HeightFogMaterialPlugin.cameraPosition);
      }
    }
  }

  public override getCustomCode(shaderType: string): Nullable<{ [pointName: string]: string }> {
    if (shaderType === 'fragment') {
      const isPBR = this._material.getClassName().includes('PBR');
      const targetVar = isPBR ? 'finalColor.rgb' : 'color.rgb';

      return {
        'CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR': `
          #if defined(CUSTOM_HEIGHT_FOG)
          if (uCustomHeightFogControls.w > 0.5) {
            float hfDist = distance(vPositionW, uCustomHeightFogCamPos);
            float hfDistFactor = smoothstep(uCustomHeightFogParams.z, uCustomHeightFogParams.w, hfDist);
            
            float hfRelY = max(0.0, vPositionW.y - uCustomHeightFogParams.x);
            float hfHeightFactor = clamp(1.0 - (hfRelY / max(0.1, uCustomHeightFogParams.y)), 0.0, 1.0);
            hfHeightFactor = pow(hfHeightFactor, uCustomHeightFogControls.y);
            
            float hfTotal = clamp(hfDistFactor * hfHeightFactor * uCustomHeightFogControls.x, 0.0, 1.0);
            ${targetVar} = mix(${targetVar}, uCustomHeightFogColor, hfTotal);
          }
          #endif
        `
      };
    }
    return null;
  }
}