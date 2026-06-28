
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UiDialogos } from './ui-dialogos';

describe('UiDialogos', () => {
  let component: UiDialogos;
  let fixture: ComponentFixture<UiDialogos>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiDialogos],
    }).compileComponents();

    fixture = TestBed.createComponent(UiDialogos);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

