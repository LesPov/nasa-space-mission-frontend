import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UiInspect } from './ui-inspect';

describe('UiInspect', () => {
  let component: UiInspect;
  let fixture: ComponentFixture<UiInspect>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiInspect],
    }).compileComponents();

    fixture = TestBed.createComponent(UiInspect);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
