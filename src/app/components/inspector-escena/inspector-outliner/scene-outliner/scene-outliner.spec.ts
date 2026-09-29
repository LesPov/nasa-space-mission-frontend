import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SceneOutliner } from './scene-outliner';

describe('SceneOutliner', () => {
  let component: SceneOutliner;
  let fixture: ComponentFixture<SceneOutliner>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SceneOutliner],
    }).compileComponents();

    fixture = TestBed.createComponent(SceneOutliner);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
