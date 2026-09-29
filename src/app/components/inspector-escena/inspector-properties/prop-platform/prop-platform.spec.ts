import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PropPlatform } from './prop-platform';

describe('PropPlatform', () => {
  let component: PropPlatform;
  let fixture: ComponentFixture<PropPlatform>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PropPlatform],
    }).compileComponents();

    fixture = TestBed.createComponent(PropPlatform);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
