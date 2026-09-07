
import { Injectable, signal } from '@angular/core';
import { NarrativeRoleDto } from '../../../core/engine/models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class RoleModalService {
  public showRoleSelector = signal(false);
  public availableRoles = signal<NarrativeRoleDto[]>([]);
  private resolveCallback: ((uid: string) => void) | null = null;
  private cancelCallback: (() => void) | null = null;

  openSelector(roles: NarrativeRoleDto[], onResolve: (uid: string) => void, onCancel?: () => void) {
    this.availableRoles.set(roles);
    this.resolveCallback = onResolve;
    this.cancelCallback = onCancel || null;
    this.showRoleSelector.set(true);
  }

  selectRole(uid: string) {
    this.showRoleSelector.set(false);
    if (this.resolveCallback) this.resolveCallback(uid);
  }

  cancel() {
    this.showRoleSelector.set(false);
    if (this.cancelCallback) this.cancelCallback();
  }
}