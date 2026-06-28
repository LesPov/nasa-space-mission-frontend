
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UiRadialMenu } from './ui-radial-menu';

describe('UiRadialMenu', () => {
  let component: UiRadialMenu;
  let fixture: ComponentFixture<UiRadialMenu>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiRadialMenu],
    }).compileComponents();

    fixture = TestBed.createComponent(UiRadialMenu);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

