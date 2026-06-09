import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OrientationGizmo } from './orientation-gizmo';

describe('OrientationGizmo', () => {
  let component: OrientationGizmo;
  let fixture: ComponentFixture<OrientationGizmo>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrientationGizmo],
    }).compileComponents();

    fixture = TestBed.createComponent(OrientationGizmo);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
