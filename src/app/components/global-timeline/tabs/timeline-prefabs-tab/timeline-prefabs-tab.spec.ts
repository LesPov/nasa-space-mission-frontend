import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimelinePrefabsTab } from './timeline-prefabs-tab';

describe('TimelinePrefabsTab', () => {
  let component: TimelinePrefabsTab;
  let fixture: ComponentFixture<TimelinePrefabsTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimelinePrefabsTab],
    }).compileComponents();

    fixture = TestBed.createComponent(TimelinePrefabsTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
