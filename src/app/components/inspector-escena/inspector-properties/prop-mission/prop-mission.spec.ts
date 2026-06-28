
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PropMission } from './prop-mission';

describe('PropMission', () => {
  let component: PropMission;
  let fixture: ComponentFixture<PropMission>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PropMission],
    }).compileComponents();

    fixture = TestBed.createComponent(PropMission);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

