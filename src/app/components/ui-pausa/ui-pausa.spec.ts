
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UiPausa } from './ui-pausa';

describe('UiPausa', () => {
  let component: UiPausa;
  let fixture: ComponentFixture<UiPausa>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiPausa],
    }).compileComponents();

    fixture = TestBed.createComponent(UiPausa);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

