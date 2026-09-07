import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimelineRolesTab } from './timeline-roles-tab';

describe('TimelineRolesTab', () => {
  let component: TimelineRolesTab;
  let fixture: ComponentFixture<TimelineRolesTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimelineRolesTab],
    }).compileComponents();

    fixture = TestBed.createComponent(TimelineRolesTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
