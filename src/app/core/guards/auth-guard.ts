import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth';
 
export const authGuard: CanActivateFn = (route, state) => {
  const authSvc = inject(AuthService);
  const router = inject(Router);

  if (authSvc.isLoggedIn()) { return true; }
  
  router.navigate(['/login']);
  return false;
};