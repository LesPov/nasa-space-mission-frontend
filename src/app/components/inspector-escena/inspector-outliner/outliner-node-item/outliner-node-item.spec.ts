import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OutlinerNodeItem } from './outliner-node-item';

describe('OutlinerNodeItem', () => {
  let component: OutlinerNodeItem;
  let fixture: ComponentFixture<OutlinerNodeItem>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OutlinerNodeItem],
    }).compileComponents();

    fixture = TestBed.createComponent(OutlinerNodeItem);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
