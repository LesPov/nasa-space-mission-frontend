
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UiNotificacion } from './ui-notificacion';

describe('UiNotificacion', () => {
  let component: UiNotificacion;
  let fixture: ComponentFixture<UiNotificacion>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiNotificacion],
    }).compileComponents();

    fixture = TestBed.createComponent(UiNotificacion);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

