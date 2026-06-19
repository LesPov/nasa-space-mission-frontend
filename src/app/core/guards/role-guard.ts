
import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth';
 
export const roleGuard: CanActivateFn = (route, state) => {
  const authSvc = inject(AuthService);
  const router = inject(Router);
  
  const expectedRole = route.data['role']; // Lo definiremos en app.routes.ts
  const currentUserRole = authSvc.currentUser()?.rol;

  // Si no hay usuario logueado, lo mandamos al login
  if (!currentUserRole) {
    router.navigate(['/login']);
    return false;
  }

  // 🔥 SOLUCIÓN: El Admin tiene privilegios absolutos. Puede entrar a las rutas de USER para jugar el modo final.
  if (currentUserRole === 'admin') {
    return true;
  }
  
  // Si el rol coincide exactamente con el esperado por la ruta (Ej: user === user)
  if (currentUserRole === expectedRole) {
    return true;
  }

  // Si no tiene el rol, lo pateamos al login
  router.navigate(['/login']);
  return false;
};