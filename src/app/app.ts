import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UiProfilerComponent } from './components/ui-profiler/ui-profiler';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UiProfilerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('juego-politico');
}