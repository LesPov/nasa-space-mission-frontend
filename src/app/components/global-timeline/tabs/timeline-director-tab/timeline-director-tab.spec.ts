import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimelineDirectorTab } from './timeline-director-tab';

describe('TimelineDirectorTab', () => {
  let component: TimelineDirectorTab;
  let fixture: ComponentFixture<TimelineDirectorTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimelineDirectorTab],
    }).compileComponents();

    fixture = TestBed.createComponent(TimelineDirectorTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
