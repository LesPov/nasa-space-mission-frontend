
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UiHud } from './ui-hud';

describe('UiHud', () => {
  let component: UiHud;
  let fixture: ComponentFixture<UiHud>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiHud],
    }).compileComponents();

    fixture = TestBed.createComponent(UiHud);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

