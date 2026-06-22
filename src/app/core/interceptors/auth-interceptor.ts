import { HttpInterceptorFn } from '@angular/common/http';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('token');

  if (token) {
    // Clonamos la petición y le pegamos el token en el Header
    const authReq = req.clone({
      setHeaders: { 
        Authorization: `Bearer ${token}` 
      }
    });
    return next(authReq);
  }

  return next(req);
};