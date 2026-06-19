import { Routes } from '@angular/router';
 
import { BodyAdmin } from './layouts/admin-layout/body-admin/body-admin';
import { JuegoPantalla } from './pages/player/juego-pantalla/juego-pantalla';
import { Dashboard } from './pages/admin/dashboard/dashboard';
import { EditorEscena } from './pages/admin/editor-escena/editor-escena';
import { EditorDialogos } from './pages/admin/editor-dialogos/editor-dialogos';
import { GestionUsuarios } from './pages/admin/gestion-usuarios/gestion-usuarios';
import { SeleccionEpisodios } from './pages/player/seleccion-episodios/seleccion-episodios';
import { HomeMenu } from './pages/home-menu/home-menu';
import { Login } from './pages/auth/login/login';
import { Registro } from './pages/auth/registro/registro';
import { authGuard } from './core/guards/auth-guard';
import { roleGuard } from './core/guards/role-guard';

// ... (Tus importaciones actuales de componentes) ...

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: Login },
  { path: 'registro', component: Registro },
  
  // ZONA DE JUGADOR (Protegida, requiere rol 'user' o 'admin')
  { 
    path: 'menu', 
    component: HomeMenu, 
    canActivate: [authGuard] 
  },
 { 
  path: 'jugador/episodios', 
  component: SeleccionEpisodios, 
  canActivate: [authGuard, roleGuard], 
  data: { role: 'user' } 
},
{ 
  path: 'jugador/jugar/:id', 
  component: JuegoPantalla, 
  canActivate: [authGuard, roleGuard], 
  data: { role: 'user' } 
},

  // ZONA DE ADMINISTRADOR (Súper protegida, requiere rol 'admin')
  { 
    path: 'admin', 
    component: BodyAdmin,
    canActivate: [authGuard, roleGuard],
    data: { role: 'admin' }, // Pide explícitamente ser admin
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: Dashboard },
      { path: 'editor-escena', component: EditorEscena },
      { path: 'editor-dialogos', component: EditorDialogos },
      { path: 'usuarios', component: GestionUsuarios }
    ]
  },

  { path: '**', redirectTo: 'login' }
];