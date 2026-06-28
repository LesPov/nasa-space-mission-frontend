
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UiLoading } from './ui-loading';

describe('UiLoading', () => {
  let component: UiLoading;
  let fixture: ComponentFixture<UiLoading>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiLoading],
    }).compileComponents();

    fixture = TestBed.createComponent(UiLoading);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

