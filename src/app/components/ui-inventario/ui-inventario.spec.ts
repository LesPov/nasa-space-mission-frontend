import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UiInventario } from './ui-inventario';

describe('UiInventario', () => {
  let component: UiInventario;
  let fixture: ComponentFixture<UiInventario>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiInventario],
    }).compileComponents();

    fixture = TestBed.createComponent(UiInventario);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
