import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Ubicacion3d } from './ubicacion3d';

describe('Ubicacion3d', () => {
  let component: Ubicacion3d;
  let fixture: ComponentFixture<Ubicacion3d>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Ubicacion3d],
    }).compileComponents();

    fixture = TestBed.createComponent(Ubicacion3d);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
