import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimelinePlatformTab } from './timeline-platform-tab';

describe('TimelinePlatformTab', () => {
  let component: TimelinePlatformTab;
  let fixture: ComponentFixture<TimelinePlatformTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimelinePlatformTab],
    }).compileComponents();

    fixture = TestBed.createComponent(TimelinePlatformTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
