
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PanelTickets } from './panel-tickets';

describe('PanelTickets', () => {
  let component: PanelTickets;
  let fixture: ComponentFixture<PanelTickets>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PanelTickets],
    }).compileComponents();

    fixture = TestBed.createComponent(PanelTickets);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

