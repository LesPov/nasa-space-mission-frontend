import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth';
 
export const roleGuard: CanActivateFn = (route, state) => {
  const authSvc = inject(AuthService);
  const router = inject(Router);
  
  const expectedRole = route.data['role']; 
  const currentUserRole = authSvc.currentUser()?.rol;

  if (!currentUserRole) {
    router.navigate(['/login']);
    return false;
  }

  // Admin tiene privilegios absolutos, y si hace match también se permite.
  if (authSvc.isAdmin() || currentUserRole === expectedRole) {
    return true;
  }

  router.navigate(['/login']);
  return false;
};