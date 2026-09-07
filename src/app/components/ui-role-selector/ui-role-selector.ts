
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RoleModalService } from '../../services/editor/modals/role-modal.service';

@Component({
  selector: 'app-ui-role-selector',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="role-overlay" *ngIf="roleSvc.showRoleSelector()">
      <div class="role-modal">
        <h2>Selecciona tu Personaje</h2>
        <div class="role-grid">
          <div class="role-card" *ngFor="let role of roleSvc.availableRoles()" (click)="roleSvc.selectRole(role.uid)">
             <h3>{{ role.name }}</h3>
             <p>{{ role.description || 'Este personaje no tiene descripción.' }}</p>
          </div>
        </div>
        <button class="btn-cancel" (click)="roleSvc.cancel()">Volver</button>
      </div>
    </div>
  `,
  styles: [`
    .role-overlay { position: absolute; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); z-index: 11000; display:flex; justify-content:center; align-items:center; }
    .role-modal { background: #1e293b; padding: 30px; border-radius: 12px; width: 600px; max-width: 90vw; border: 1px solid #334155; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
    h2 { color: #60a5fa; margin-top: 0; margin-bottom: 20px; font-weight: 800; text-transform: uppercase; }
    .role-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .role-card { background: #0f172a; border: 1px solid #475569; padding: 20px; border-radius: 8px; cursor: pointer; transition: 0.2s; }
    .role-card:hover { border-color: #60a5fa; transform: translateY(-5px); box-shadow: 0 10px 20px rgba(0,0,0,0.5); }
    .role-card h3 { color: white; margin: 0 0 10px 0; font-size: 18px; }
    .role-card p { color: #94a3b8; font-size: 12px; margin: 0; }
    .btn-cancel { background: transparent; color: #94a3b8; border: none; font-size: 14px; cursor: pointer; padding: 10px; font-weight: bold; text-transform: uppercase;}
    .btn-cancel:hover { color: white; }
  `]
})
export class UiRoleSelectorComponent {
  public roleSvc = inject(RoleModalService);
}