
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderAdmin } from '../header-admin/header-admin';
import { NavbarAdmin } from '../navbar-admin/navbar-admin';
import { LayoutService } from '../../../services/layout.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-body-admin',
  standalone: true,
  imports: [RouterOutlet, HeaderAdmin, NavbarAdmin, CommonModule],
  templateUrl: './body-admin.html',
  styleUrls: ['./body-admin.css']
})
export class BodyAdmin {
  public layoutSvc = inject(LayoutService);
}
