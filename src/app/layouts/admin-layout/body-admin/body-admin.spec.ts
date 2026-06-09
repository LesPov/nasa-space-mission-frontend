import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BodyAdmin } from './body-admin';

describe('BodyAdmin', () => {
  let component: BodyAdmin;
  let fixture: ComponentFixture<BodyAdmin>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BodyAdmin],
    }).compileComponents();

    fixture = TestBed.createComponent(BodyAdmin);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
