import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth';
 
export const roleGuard: CanActivateFn = (route, state) => {
  const authSvc = inject(AuthService);
  const router = inject(Router);
  
  const expectedRole = route.data['role']; // Lo definiremos en app.routes.ts
  
  if (authSvc.currentUser()?.rol === expectedRole) {
    return true;
  }

  // Si no tiene el rol, lo pateamos al menú
  router.navigate(['/menu']);
  return false;
};