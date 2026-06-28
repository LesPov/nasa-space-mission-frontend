
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-navbar-admin',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './navbar-admin.html',
  styleUrls: ['./navbar-admin.css']
})
export class NavbarAdmin {
  navData = [
    { routerLink: '/admin/dashboard', icon: '📊', label: 'Dashboard' },
    { routerLink: '/admin/editor-escena', icon: '🎮', label: 'Editor de Mapa' },
    { routerLink: '/admin/editor-dialogos', icon: '💬', label: 'IA y Diálogos' },
    { routerLink: '/admin/usuarios', icon: '👥', label: 'Usuarios' }
  ];
}
