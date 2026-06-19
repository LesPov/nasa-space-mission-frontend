
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UiMission } from './ui-mission';

describe('UiMission', () => {
  let component: UiMission;
  let fixture: ComponentFixture<UiMission>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiMission],
    }).compileComponents();

    fixture = TestBed.createComponent(UiMission);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
